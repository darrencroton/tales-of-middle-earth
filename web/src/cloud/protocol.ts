/**
 * What the app and the sync service (server/src/worker.ts) say to each other.
 * No DOM here: the Worker imports it too.
 */

/** A file kept in the cloud: the SHA-256 of its bytes (hex) and its size. */
export interface CloudFile {
  hash: string;
  size: number;
}

/** Where a hero is played: the device that last took them up, and whether it is playing them now. */
export interface Lease {
  /** The device's id (random, kept in the browser). */
  device: string;
  /** The device's name, for the player: "iPhone", "iPad", "Mac". */
  name: string;
  /** True while a game of the hero is open there; false once it was saved and set down. */
  playing: boolean;
  /** When the lease was written (server time, ms); a client sends 0 and the server stamps it. */
  at: number;
  /** The device this one took the hero from while it was playing them (the player chose to). */
  over?: string;
}

export interface Manifest {
  /** Counts the commits; 0 for an account with nothing synced yet. */
  rev: number;
  /** Every file, by its path under the storage root. */
  files: Record<string, CloudFile>;
  /** Heroes' leases, by savefile name. */
  heroes: Record<string, Lease>;
}

export interface SyncState {
  manifest: Manifest;
  /** The manifest's version, sent back with a commit (If-Match). */
  etag: string;
  /** The server's clock (ms), to judge how old a lease is. */
  now: number;
  /** A fresh session token, when the one sent is getting old. */
  session?: string;
}

/** A commit refused because blobs it names are not stored. */
export interface MissingBlobs {
  missing: string[];
}

export interface Challenge {
  /** The challenge to sign (base64url). */
  challenge: string;
  /** Signed by the server, returned with the answer. */
  token: string;
  /** For a new account: the user id to register the passkey under (base64url). */
  user?: string;
}

export interface Registration {
  token: string;
  credential: string;
  /** The public key, SubjectPublicKeyInfo (base64url). */
  publicKey: string;
  /** COSE algorithm: -7 (ES256) or -257 (RS256). */
  algorithm: number;
  clientData: string;
  authenticatorData: string;
}

export interface Assertion {
  token: string;
  credential: string;
  clientData: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string;
}

export interface Session {
  session: string;
  /** The account's id. */
  user: string;
}

export const EMPTY_MANIFEST: Manifest = { rev: 0, files: {}, heroes: {} };

/** Most bytes one file may have. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Most bytes an account's files may add up to, as stored (compressed). */
export const MAX_ACCOUNT_BYTES = 200 * 1024 * 1024;

const HASH = /^[0-9a-f]{64}$/;

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value);
}

/** Only relative paths of ordinary segments, so nothing can be written outside the storage directory. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isLease(value: unknown): value is Lease {
  const lease = value as Partial<Lease> | null;
  return (
    !!lease &&
    typeof lease.device === 'string' &&
    lease.device.length <= 64 &&
    typeof lease.name === 'string' &&
    lease.name.length <= 64 &&
    typeof lease.playing === 'boolean' &&
    typeof lease.at === 'number' &&
    (lease.over === undefined || (typeof lease.over === 'string' && lease.over.length <= 64))
  );
}

/** The manifest when `raw` is a well-formed one, else null. */
export function readManifest(raw: unknown): Manifest | null {
  const value = raw as Partial<Manifest> | null;
  if (!value || typeof value !== 'object' || typeof value.rev !== 'number' || !value.files || !value.heroes) return null;
  if (typeof value.files !== 'object' || typeof value.heroes !== 'object') return null;
  const files: Record<string, CloudFile> = Object.create(null);
  for (const [path, file] of Object.entries(value.files)) {
    if (!isSafeRelativePath(path) || !file || !isHash(file.hash) || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) return null;
    files[path] = { hash: file.hash, size: file.size };
  }
  const heroes: Record<string, Lease> = Object.create(null);
  for (const [base, lease] of Object.entries(value.heroes)) {
    if (!base || base.length > 64 || !isLease(lease)) return null;
    heroes[base] = { device: lease.device, name: lease.name, playing: lease.playing, at: lease.at, ...(lease.over ? { over: lease.over } : {}) };
  }
  return { rev: value.rev, files, heroes };
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function gzip(data: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(data, new CompressionStream('gzip'));
}

export function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(data, new DecompressionStream('gzip'));
}
