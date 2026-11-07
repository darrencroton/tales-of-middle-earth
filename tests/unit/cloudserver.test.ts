import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handle, derToRaw, type Env } from '../../server/src/worker.ts';
import { base64url, fromBase64url, gzip, sha256Hex, type Challenge, type Manifest, type SyncState } from '../../web/src/cloud/protocol.ts';
import { MemoryBucket } from '../memorybucket.ts';

const ORIGIN = 'https://example.github.io';
const NOW = 1_800_000_000_000;

function env(): Env {
  return { SAVES: new MemoryBucket(), SESSION_SECRET: 'test-secret', ALLOWED_ORIGINS: `${ORIGIN},http://localhost:4173` };
}

function call(e: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = NOW): Promise<Response> {
  const init: RequestInit = { method, headers: { Origin: ORIGIN, ...headers } };
  if (body instanceof Uint8Array) init.body = body as Uint8Array<ArrayBuffer>;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return handle(new Request(`https://cloud.test${path}`, init), e, now);
}

/** Raw r‖s to the DER WebAuthn sends. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (part: Uint8Array) => {
    let i = 0;
    while (i < part.length - 1 && part[i] === 0) i++;
    let bytes = part.subarray(i);
    if (bytes[0] & 0x80) bytes = Uint8Array.of(0, ...bytes);
    return Uint8Array.of(0x02, bytes.length, ...bytes);
  };
  const r = int(raw.subarray(0, 32));
  const s = int(raw.subarray(32));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
}

/** A passkey made and used in software, as an authenticator would. */
class SoftPasskey {
  readonly id = crypto.getRandomValues(new Uint8Array(16));
  user = '';
  private keys!: CryptoKeyPair;
  readonly origin: string;

  constructor(origin = ORIGIN) {
    this.origin = origin;
  }

  private async authData(flags: number, attested?: Uint8Array): Promise<Uint8Array> {
    const rp = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(new URL(this.origin).hostname)));
    const head = Uint8Array.of(...rp, flags, 0, 0, 0, 1);
    if (!attested) return head;
    return Uint8Array.of(...head, ...new Uint8Array(16), 0, this.id.length, ...this.id, ...attested);
  }

  private clientData(type: string, challenge: string): string {
    return base64url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin: this.origin })));
  }

  async register(e: Env): Promise<string> {
    const options = (await (await call(e, 'POST', '/v1/register/options')).json()) as Challenge;
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', this.keys.publicKey));
    const res = await call(e, 'POST', '/v1/register', {
      token: options.token,
      credential: base64url(this.id),
      publicKey: base64url(spki),
      algorithm: -7,
      clientData: this.clientData('webauthn.create', options.challenge),
      authenticatorData: base64url(await this.authData(0x45, new Uint8Array([0xa0]))),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const answer = (await res.json()) as { session: string; user: string };
    this.user = answer.user;
    return answer.session;
  }

  async login(e: Env, tamper = false): Promise<Response> {
    const options = (await (await call(e, 'POST', '/v1/login/options')).json()) as Challenge;
    const clientData = this.clientData('webauthn.get', options.challenge);
    const authData = await this.authData(0x05);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64url(clientData) as Uint8Array<ArrayBuffer>));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, Uint8Array.of(...authData, ...hash)));
    if (tamper) raw[10] ^= 1;
    return call(e, 'POST', '/v1/login', {
      token: options.token,
      credential: base64url(this.id),
      clientData,
      authenticatorData: base64url(authData),
      signature: base64url(rawToDer(raw)),
    });
  }
}

async function upload(e: Env, session: string, data: Uint8Array): Promise<string> {
  const hash = await sha256Hex(data);
  const res = await call(e, 'PUT', `/v1/blob/${hash}`, await gzip(data), { Authorization: `Bearer ${session}` });
  assert.equal(res.status, 204, await res.clone().text());
  return hash;
}

async function state(e: Env, session: string, now = NOW): Promise<SyncState> {
  const res = await call(e, 'GET', '/v1/sync', undefined, { Authorization: `Bearer ${session}` }, now);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as SyncState;
}

function commit(e: Env, session: string, etag: string, manifest: Manifest): Promise<Response> {
  return call(e, 'PUT', '/v1/sync', manifest, { Authorization: `Bearer ${session}`, 'If-Match': etag });
}

describe('cloud service', () => {
  it('registers a passkey, signs in with it and refuses a forged signature', async () => {
    const e = env();
    const key = new SoftPasskey();
    const session = await key.register(e);
    assert.equal((await state(e, session)).manifest.rev, 0);
    const login = await key.login(e);
    assert.equal(login.status, 200);
    assert.equal(((await login.json()) as { user: string }).user, key.user);
    assert.equal((await key.login(e, true)).status, 401);
  });

  it('refuses another origin and an unknown session', async () => {
    const e = env();
    await assert.rejects(new SoftPasskey('https://evil.example').register(e));
    assert.equal((await call(e, 'GET', '/v1/sync', undefined, { Authorization: 'Bearer nonsense.x' })).status, 401);
    const preflight = await call(e, 'OPTIONS', '/v1/sync', undefined, { Origin: 'https://evil.example' });
    assert.equal(preflight.status, 403);
  });

  it('commits by compare-and-swap, needs the blobs first, stamps leases and drops blobs no longer named', async () => {
    const e = env();
    const session = await new SoftPasskey().register(e);
    const first = await state(e, session);
    const data = new TextEncoder().encode('a savefile');
    const hash = await sha256Hex(data);
    const manifest: Manifest = { rev: 0, files: { '2.4/save/Elder': { hash, size: data.length } }, heroes: { Elder: { device: 'd1', name: 'iPhone', playing: true, at: 0 } } };

    const missing = await commit(e, session, first.etag, manifest);
    assert.equal(missing.status, 409);
    assert.deepEqual(((await missing.json()) as { missing: string[] }).missing, [hash]);

    await upload(e, session, data);
    const done = await commit(e, session, first.etag, manifest);
    assert.equal(done.status, 200);
    const after = (await done.json()) as SyncState;
    assert.equal(after.manifest.rev, 1);
    assert.equal(after.manifest.heroes.Elder.at, NOW);

    assert.equal((await commit(e, session, first.etag, manifest)).status, 412, 'a stale etag is refused');

    const blob = await call(e, 'GET', `/v1/blob/${hash}`, undefined, { Authorization: `Bearer ${session}` });
    assert.equal(blob.status, 200);

    const bucket = e.SAVES as MemoryBucket;
    bucket.clock = () => NOW;
    const pending = await upload(e, session, new TextEncoder().encode('a level on its way'));
    const emptied = await commit(e, session, after.etag, { rev: 1, files: {}, heroes: {} });
    assert.equal(emptied.status, 200);
    assert.equal((await call(e, 'GET', `/v1/blob/${hash}`, undefined, { Authorization: `Bearer ${session}` })).status, 404, 'an old blob no longer named goes');
    assert.equal((await call(e, 'GET', `/v1/blob/${pending}`, undefined, { Authorization: `Bearer ${session}` })).status, 200, 'one just uploaded stays for its commit');
  });

  it('refuses a blob whose bytes do not match its hash, or that inflates beyond a file', async () => {
    const e = env();
    const session = await new SoftPasskey().register(e);
    const res = await call(e, 'PUT', `/v1/blob/${'0'.repeat(64)}`, await gzip(new Uint8Array([1, 2, 3])), { Authorization: `Bearer ${session}` });
    assert.equal(res.status, 400);
    const bomb = await call(e, 'PUT', `/v1/blob/${'0'.repeat(64)}`, await gzip(new Uint8Array(17 * 1024 * 1024)), { Authorization: `Bearer ${session}` });
    assert.equal(bomb.status, 413);
  });

  it('renews an old session and deletes an account with its passkeys', async () => {
    const e = env();
    const key = new SoftPasskey();
    const session = await key.register(e);
    const later = await state(e, session, NOW + 40 * 24 * 60 * 60 * 1000);
    assert.ok(later.session);
    assert.equal((await call(e, 'DELETE', '/v1/account', undefined, { Authorization: `Bearer ${session}` })).status, 204);
    assert.equal((e.SAVES as MemoryBucket).objects.size, 0);
    assert.equal((await key.login(e)).status, 404);
    const data = new TextEncoder().encode('after');
    const late = await call(e, 'PUT', `/v1/blob/${await sha256Hex(data)}`, await gzip(data), { Authorization: `Bearer ${session}` });
    assert.equal(late.status, 404, 'a deleted account stores nothing more');
  });

  it('reads DER signatures with and without leading zeros', () => {
    const raw = new Uint8Array(64);
    raw[0] = 0x80;
    raw[32] = 0;
    raw[33] = 0x7f;
    raw[63] = 1;
    assert.deepEqual(derToRaw(rawToDer(raw)), raw);
  });
});
