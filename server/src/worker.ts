/**
 * The cloud sync service: a Cloudflare Worker over an R2 bucket. Players sign
 * in with a passkey (no names, emails or passwords are kept) and keep their
 * saves as content-addressed blobs under a manifest that changes only by
 * compare-and-swap. See server/README.md.
 */
import {
  EMPTY_MANIFEST,
  MAX_ACCOUNT_BYTES,
  MAX_FILE_BYTES,
  base64url,
  fromBase64url,
  isHash,
  readManifest,
  sha256Hex,
  type Assertion,
  type Challenge,
  type Manifest,
  type Registration,
  type Session,
  type SyncState,
} from '../../web/src/cloud/protocol.ts';

/** The parts of R2's bucket binding the service uses. */
export interface Bucket {
  get(key: string): Promise<{ etag: string; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } | null>;
  head(key: string): Promise<{ etag: string; size: number } | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { onlyIf?: { etagMatches?: string } }): Promise<{ etag: string } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string; size: number; uploaded: Date }[]; truncated: boolean; cursor?: string }>;
}

export interface Env {
  SAVES: Bucket;
  /** Signs challenges and sessions (a long random string, set with `wrangler secret put`). */
  SESSION_SECRET: string;
  /** Origins the app is served from, comma-separated; a passkey belongs to its origin's host name. */
  ALLOWED_ORIGINS: string;
  /** Workers' rate limiting, for account creation by address (wrangler.toml); none in tests. */
  REGISTER_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const CHALLENGE_MS = 5 * 60 * 1000;
const SESSION_MS = 400 * 24 * 60 * 60 * 1000;
/** A session older than this gets a fresh token with its next sync. */
const SESSION_RENEW_MS = 30 * 24 * 60 * 60 * 1000;
const ES256 = -7;
const RS256 = -257;
const MAX_JSON_BYTES = 256 * 1024;
/** Blobs no manifest names are deleted once this old: one uploaded for a commit still on its way is left alone. */
const BLOB_GRACE_MS = 60 * 60 * 1000;

class Failure extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body ?? { error: message };
  }
}

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function buffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

interface ChallengeClaims {
  kind: 'challenge';
  challenge: string;
  user?: string;
  exp: number;
}

interface SessionClaims {
  kind: 'session';
  user: string;
  iat: number;
  exp: number;
}

type Claims = ChallengeClaims | SessionClaims;

/** A token the service alone can make: the claims and their HMAC. */
export async function sign(secret: string, claims: Claims): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${base64url(await hmac(secret, payload))}`;
}

async function verify<K extends Claims['kind']>(secret: string, token: unknown, kind: K, now: number): Promise<Extract<Claims, { kind: K }>> {
  if (typeof token !== 'string') throw new Failure(401, 'Missing token');
  const [payload, mac] = token.split('.');
  if (!payload || !mac) throw new Failure(401, 'Malformed token');
  let given: Uint8Array;
  try {
    given = fromBase64url(mac);
  } catch {
    throw new Failure(401, 'Malformed token');
  }
  if (!equalBytes(given, await hmac(secret, payload))) throw new Failure(401, 'Bad token');
  let claims: Claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Claims;
  } catch {
    throw new Failure(401, 'Malformed token');
  }
  if (claims.kind !== kind || typeof claims.exp !== 'number' || claims.exp < now) throw new Failure(401, 'Expired token');
  return claims as Extract<Claims, { kind: K }>;
}

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** The relying party of an origin: its host name. */
function rpId(origin: string): string {
  return new URL(origin).hostname;
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
}

function readClientData(text: string): { data: ClientData; bytes: Uint8Array } {
  try {
    const bytes = fromBase64url(text);
    const data = JSON.parse(new TextDecoder().decode(bytes)) as ClientData;
    if (typeof data.type !== 'string' || typeof data.challenge !== 'string' || typeof data.origin !== 'string') throw new Error('fields');
    return { data, bytes };
  } catch {
    throw new Failure(400, 'Malformed client data');
  }
}

/** Checks what the browser signed: the ceremony, the challenge, an allowed origin, and the authenticator's data for that origin's host, with the user present. */
async function checkCeremony(env: Env, clientData: ClientData, type: string, challenge: string, authData: Uint8Array): Promise<void> {
  if (clientData.type !== type) throw new Failure(400, 'Wrong ceremony');
  if (clientData.challenge !== challenge) throw new Failure(400, 'Wrong challenge');
  if (!allowedOrigins(env).includes(clientData.origin)) throw new Failure(403, 'Origin not allowed');
  if (authData.length < 37) throw new Failure(400, 'Malformed authenticator data');
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(rpId(clientData.origin))));
  if (!equalBytes(authData.subarray(0, 32), rpHash)) throw new Failure(400, 'Wrong relying party');
  if (!(authData[32] & 0x01)) throw new Failure(400, 'User not present');
}

/** The credential id in a registration's authenticator data (after the RP hash, flags, counter and AAGUID). */
function attestedCredential(authData: Uint8Array): Uint8Array | null {
  if (!(authData[32] & 0x40) || authData.length < 55) return null;
  const length = (authData[53] << 8) | authData[54];
  if (authData.length < 55 + length) return null;
  return authData.subarray(55, 55 + length);
}

function importParams(algorithm: number): EcKeyImportParams | RsaHashedImportParams {
  if (algorithm === ES256) return { name: 'ECDSA', namedCurve: 'P-256' };
  if (algorithm === RS256) return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  throw new Failure(400, 'Unsupported algorithm');
}

/** An ECDSA signature from DER (as WebAuthn gives it) to the raw r‖s Web Crypto checks. */
export function derToRaw(der: Uint8Array): Uint8Array {
  const fail = () => new Failure(400, 'Malformed signature');
  if (der[0] !== 0x30) throw fail();
  let at = 2;
  if (der[1] & 0x80) at = 2 + (der[1] & 0x7f);
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[at] !== 0x02) throw fail();
    let length = der[at + 1];
    let start = at + 2;
    at = start + length;
    if (at > der.length) throw fail();
    while (length > 32 && der[start] === 0) {
      start++;
      length--;
    }
    if (length > 32) throw fail();
    out.set(der.subarray(start, start + length), part * 32 + (32 - length));
  }
  return out;
}

async function verifySignature(algorithm: number, publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey('spki', buffer(publicKey), importParams(algorithm), false, ['verify']);
  if (algorithm === ES256) return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, buffer(derToRaw(signature)), buffer(data));
  return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, buffer(signature), buffer(data));
}

interface StoredCredential {
  user: string;
  publicKey: string;
  algorithm: number;
}

const credentialKey = (id: string) => `credential/${id}`;
const userPrefix = (user: string) => `user/${user}/`;
const manifestKey = (user: string) => `${userPrefix(user)}manifest.json`;
const blobKey = (user: string, hash: string) => `${userPrefix(user)}blob/${hash}`;
const credentialsKey = (user: string) => `${userPrefix(user)}credentials.json`;

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (length > MAX_JSON_BYTES) throw new Failure(413, 'Too large');
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new Failure(413, 'Too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Failure(400, 'Malformed JSON');
  }
}

function randomId(bytes = 16): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challenge(env: Env, now: number, user?: string): Promise<Challenge> {
  const value = randomId(32);
  return { challenge: value, token: await sign(env.SESSION_SECRET, { kind: 'challenge', challenge: value, user, exp: now + CHALLENGE_MS }), ...(user ? { user } : {}) };
}

async function newSession(env: Env, user: string, now: number): Promise<string> {
  return sign(env.SESSION_SECRET, { kind: 'session', user, iat: now, exp: now + SESSION_MS });
}

async function register(env: Env, body: Registration, now: number): Promise<Session> {
  const claims = await verify(env.SESSION_SECRET, body.token, 'challenge', now);
  if (!claims.user) throw new Failure(400, 'Not a registration');
  const { data } = readClientData(body.clientData);
  let authData: Uint8Array;
  let publicKey: Uint8Array;
  try {
    authData = fromBase64url(body.authenticatorData);
    publicKey = fromBase64url(body.publicKey);
  } catch {
    throw new Failure(400, 'Malformed registration');
  }
  await checkCeremony(env, data, 'webauthn.create', claims.challenge, authData);
  const attested = attestedCredential(authData);
  if (typeof body.credential !== 'string' || !attested || base64url(attested) !== body.credential) throw new Failure(400, 'Credential does not match');
  try {
    await crypto.subtle.importKey('spki', buffer(publicKey), importParams(body.algorithm), false, ['verify']);
  } catch (err) {
    if (err instanceof Failure) throw err;
    throw new Failure(400, 'Malformed public key');
  }
  if (await env.SAVES.head(credentialKey(body.credential))) throw new Failure(409, 'Passkey already registered');
  const stored: StoredCredential = { user: claims.user, publicKey: body.publicKey, algorithm: body.algorithm };
  await env.SAVES.put(credentialKey(body.credential), JSON.stringify(stored));
  const existing = await env.SAVES.get(credentialsKey(claims.user));
  const list = existing ? (JSON.parse(await existing.text()) as string[]) : [];
  await env.SAVES.put(credentialsKey(claims.user), JSON.stringify([...list, body.credential]));
  if (!(await env.SAVES.head(manifestKey(claims.user)))) await env.SAVES.put(manifestKey(claims.user), JSON.stringify(EMPTY_MANIFEST));
  return { session: await newSession(env, claims.user, now), user: claims.user };
}

async function login(env: Env, body: Assertion, now: number): Promise<Session> {
  const claims = await verify(env.SESSION_SECRET, body.token, 'challenge', now);
  if (typeof body.credential !== 'string') throw new Failure(400, 'Malformed assertion');
  const stored = await env.SAVES.get(credentialKey(body.credential));
  if (!stored) throw new Failure(404, 'Unknown passkey');
  const credential = JSON.parse(await stored.text()) as StoredCredential;
  const { data, bytes } = readClientData(body.clientData);
  let authData: Uint8Array;
  let signature: Uint8Array;
  try {
    authData = fromBase64url(body.authenticatorData);
    signature = fromBase64url(body.signature);
  } catch {
    throw new Failure(400, 'Malformed assertion');
  }
  await checkCeremony(env, data, 'webauthn.get', claims.challenge, authData);
  if (body.userHandle && body.userHandle !== credential.user) throw new Failure(401, 'Wrong user');
  const signed = concat(authData, new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(bytes))));
  if (!(await verifySignature(credential.algorithm, fromBase64url(credential.publicKey), signature, signed))) throw new Failure(401, 'Bad signature');
  return { session: await newSession(env, credential.user, now), user: credential.user };
}

async function sessionOf(env: Env, request: Request, now: number): Promise<SessionClaims> {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return verify(env.SESSION_SECRET, match?.[1], 'session', now);
}

async function readStoredManifest(env: Env, user: string): Promise<{ manifest: Manifest; etag: string }> {
  const object = await env.SAVES.get(manifestKey(user));
  if (!object) throw new Failure(404, 'No such account');
  const manifest = readManifest(JSON.parse(await object.text()));
  if (!manifest) throw new Failure(500, 'Stored manifest is corrupt');
  return { manifest, etag: object.etag };
}

async function syncState(env: Env, session: SessionClaims, now: number): Promise<SyncState> {
  const { manifest, etag } = await readStoredManifest(env, session.user);
  const state: SyncState = { manifest, etag, now };
  if (now - session.iat > SESSION_RENEW_MS) state.session = await newSession(env, session.user, now);
  return state;
}

function referenced(manifest: Manifest): Set<string> {
  return new Set(Object.values(manifest.files).map((f) => f.hash));
}

/** The account's stored blobs, by hash, with their stored size and when they were uploaded (ms). */
async function storedBlobs(env: Env, user: string): Promise<Map<string, { size: number; uploaded: number }>> {
  const prefix = blobKey(user, '');
  const blobs = new Map<string, { size: number; uploaded: number }>();
  let cursor: string | undefined;
  do {
    const page = await env.SAVES.list({ prefix, cursor });
    for (const object of page.objects) blobs.set(object.key.slice(prefix.length), { size: object.size, uploaded: object.uploaded.getTime() });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

/**
 * Writes a manifest over the one with `etag`: the blobs it names must be
 * stored; leases sent with `at: 0` are stamped; when its files changed, blobs
 * no manifest names are deleted once `BLOB_GRACE_MS` old.
 */
async function commit(env: Env, user: string, etag: string | null, raw: unknown, now: number): Promise<SyncState> {
  if (!etag) throw new Failure(428, 'If-Match required');
  const sent = readManifest(raw);
  if (!sent) throw new Failure(400, 'Malformed manifest');
  const current = await readStoredManifest(env, user);
  if (current.etag !== etag) throw new Failure(412, 'Changed since read');
  const old = referenced(current.manifest);
  const named = referenced(sent);
  const changed = [...named].some((hash) => !old.has(hash)) || [...old].some((hash) => !named.has(hash));
  const blobs = changed ? await storedBlobs(env, user) : new Map<string, { size: number; uploaded: number }>();
  const missing = changed ? [...named].filter((hash) => !blobs.has(hash)) : [];
  if (missing.length) throw new Failure(409, 'Missing blobs', { missing });
  const heroes: Manifest['heroes'] = Object.create(null);
  for (const [base, lease] of Object.entries(sent.heroes)) heroes[base] = lease.at === 0 ? { ...lease, at: now } : lease;
  const manifest: Manifest = { rev: current.manifest.rev + 1, files: sent.files, heroes };
  const written = await env.SAVES.put(manifestKey(user), JSON.stringify(manifest), { onlyIf: { etagMatches: etag } });
  if (!written) throw new Failure(412, 'Changed since read');
  const stale = [...blobs].filter(([hash, blob]) => !named.has(hash) && now - blob.uploaded > BLOB_GRACE_MS).map(([hash]) => blobKey(user, hash));
  if (stale.length) await env.SAVES.delete(stale);
  return { manifest, etag: written.etag, now };
}

/** Inflates gzip, refusing more than `cap` bytes before holding them all. */
async function inflate(compressed: Uint8Array, cap: number): Promise<Uint8Array> {
  const reader = new Blob([buffer(compressed)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) throw new Failure(413, 'Too large');
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err instanceof Failure ? err : new Failure(400, 'Not gzip');
  }
  return concat(...chunks);
}

/** Stores a file the account sends, gzip-compressed as sent, within the account's allowance (counted as stored). */
async function putBlob(env: Env, user: string, hash: string, request: Request): Promise<void> {
  if (!(await env.SAVES.head(manifestKey(user)))) throw new Failure(404, 'No such account');
  const compressed = new Uint8Array(await request.arrayBuffer());
  if (compressed.length > MAX_FILE_BYTES) throw new Failure(413, 'Too large');
  const data = await inflate(compressed, MAX_FILE_BYTES);
  if ((await sha256Hex(data)) !== hash) throw new Failure(400, 'Hash does not match');
  const blobs = await storedBlobs(env, user);
  if (blobs.has(hash)) return;
  const stored = [...blobs.values()].reduce((n, b) => n + b.size, 0);
  if (stored + compressed.length > MAX_ACCOUNT_BYTES) throw new Failure(413, 'Over the storage allowance');
  await env.SAVES.put(blobKey(user, hash), compressed);
}

async function deleteAccount(env: Env, user: string): Promise<void> {
  const credentials = await env.SAVES.get(credentialsKey(user));
  const ids = credentials ? (JSON.parse(await credentials.text()) as string[]) : [];
  if (ids.length) await env.SAVES.delete(ids.map(credentialKey));
  let cursor: string | undefined;
  do {
    const page = await env.SAVES.list({ prefix: userPrefix(user), cursor });
    if (page.objects.length) await env.SAVES.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function route(request: Request, env: Env, now: number, cors: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  if (method === 'POST' && path === '/v1/register/options') {
    const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.REGISTER_LIMIT && !(await env.REGISTER_LIMIT.limit({ key: address })).success) throw new Failure(429, 'Too many new accounts; try again in a minute');
    return json(await challenge(env, now, randomId(16)), 200, cors);
  }
  if (method === 'POST' && path === '/v1/register') return json(await register(env, await readJson<Registration>(request), now), 200, cors);
  if (method === 'POST' && path === '/v1/login/options') return json(await challenge(env, now), 200, cors);
  if (method === 'POST' && path === '/v1/login') return json(await login(env, await readJson<Assertion>(request), now), 200, cors);

  const session = await sessionOf(env, request, now);
  if (path === '/v1/sync') {
    if (method === 'GET') return json(await syncState(env, session, now), 200, cors);
    if (method === 'PUT') return json(await commit(env, session.user, request.headers.get('If-Match'), await readJson<unknown>(request), now), 200, cors);
  }
  const blob = /^\/v1\/blob\/([0-9a-f]{64})$/.exec(path);
  if (blob && isHash(blob[1])) {
    if (method === 'PUT') {
      await putBlob(env, session.user, blob[1], request);
      return new Response(null, { status: 204, headers: cors });
    }
    if (method === 'GET') {
      const object = await env.SAVES.get(blobKey(session.user, blob[1]));
      if (!object) throw new Failure(404, 'No such blob');
      return new Response(await object.arrayBuffer(), { status: 200, headers: { ...cors, 'Content-Type': 'application/gzip', 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }
  }
  if (method === 'DELETE' && path === '/v1/account') {
    await deleteAccount(env, session.user);
    return new Response(null, { status: 204, headers: cors });
  }
  throw new Failure(404, 'Not found');
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
  try {
    return await route(request, env, now, cors);
  } catch (err) {
    if (err instanceof Failure) return json(err.body, err.status, cors);
    console.error(err);
    return json({ error: 'Server error' }, 500, cors);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
