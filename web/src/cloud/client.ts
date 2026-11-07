/** Talks to the sync service: passkey sign-in, the manifest and the files. */
import {
  base64url,
  fromBase64url,
  gunzip,
  gzip,
  readManifest,
  type Challenge,
  type Manifest,
  type MissingBlobs,
  type Session,
  type SyncState,
} from './protocol.ts';

/** Why a call failed: no connection, the session refused, the passkey sheet cancelled, or anything else. */
export type CloudErrorKind = 'offline' | 'auth' | 'cancelled' | 'unsupported' | 'server';

export class CloudError extends Error {
  readonly kind: CloudErrorKind;
  readonly status: number;
  constructor(kind: CloudErrorKind, message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const TIMEOUT_MS = 15_000;
const BLOB_TIMEOUT_MS = 60_000;
const PASSKEY_TIMEOUT_MS = 120_000;
const RP_NAME = 'Tales of Middle-earth';

/** True when this browser can make and use passkeys. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials;
}

export class CloudClient {
  private readonly url: string;
  private readonly session: () => string | undefined;

  /** `url`: the service's root; `session`: the token to send. */
  constructor(url: string, session: () => string | undefined) {
    this.url = url.replace(/\/+$/, '');
    this.session = session;
  }

  private async call(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string>; timeout?: number; auth?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.auth !== false) {
      const token = this.session();
      if (!token) throw new CloudError('auth', 'Not signed in');
      headers.Authorization = `Bearer ${token}`;
    }
    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, { method, headers, body: init.body, signal: AbortSignal.timeout(init.timeout ?? TIMEOUT_MS), cache: 'no-store' });
    } catch (err) {
      throw new CloudError('offline', `Could not reach the cloud: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (response.status === 401) throw new CloudError('auth', 'The cloud no longer knows this device', 401);
    return response;
  }

  private async json<T>(response: Response): Promise<T> {
    if (response.status === 429) throw new CloudError('server', 'The cloud is busy; try again in a minute', 429);
    if (!response.ok) throw new CloudError('server', `The cloud answered ${response.status}`, response.status);
    return (await response.json()) as T;
  }

  /** The cloud's manifest. */
  async state(): Promise<SyncState> {
    const response = await this.call('GET', '/v1/sync');
    if (response.status === 404) throw new CloudError('auth', 'Your cloud data was deleted', 404);
    const state = await this.json<SyncState>(response);
    const manifest = readManifest(state.manifest);
    if (!manifest || typeof state.etag !== 'string') throw new CloudError('server', 'The cloud sent a malformed manifest');
    return { ...state, manifest };
  }

  /** Writes the manifest over the one with `etag`: the new state, 'changed' when another device wrote first, or the blobs it lacks. */
  async commit(etag: string, manifest: Manifest): Promise<SyncState | 'changed' | MissingBlobs> {
    const response = await this.call('PUT', '/v1/sync', { body: JSON.stringify(manifest), headers: { 'Content-Type': 'application/json', 'If-Match': etag } });
    if (response.status === 412) return 'changed';
    if (response.status === 409) return (await response.json()) as MissingBlobs;
    const state = await this.json<SyncState>(response);
    const read = readManifest(state.manifest);
    if (!read) throw new CloudError('server', 'The cloud sent a malformed manifest');
    return { ...state, manifest: read };
  }

  async putBlob(hash: string, data: Uint8Array): Promise<void> {
    const body = await gzip(data);
    const response = await this.call('PUT', `/v1/blob/${hash}`, { body: body as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': 'application/gzip' }, timeout: BLOB_TIMEOUT_MS });
    if (!response.ok) throw new CloudError('server', `The cloud refused a file (${response.status})`, response.status);
  }

  async getBlob(hash: string): Promise<Uint8Array> {
    const response = await this.call('GET', `/v1/blob/${hash}`, { timeout: BLOB_TIMEOUT_MS });
    if (!response.ok) throw new CloudError('server', `A file could not be fetched (${response.status})`, response.status);
    return gunzip(new Uint8Array(await response.arrayBuffer()));
  }

  async deleteAccount(): Promise<void> {
    const response = await this.call('DELETE', '/v1/account');
    if (!response.ok) throw new CloudError('server', `The cloud refused (${response.status})`, response.status);
  }

  /** Makes a passkey for a new account; returns its session. */
  async register(): Promise<Session> {
    if (!passkeysSupported()) throw new CloudError('unsupported', 'This browser cannot use passkeys');
    const options = await this.json<Challenge>(await this.call('POST', '/v1/register/options', { auth: false }));
    if (!options.user) throw new CloudError('server', 'The cloud sent no account');
    const credential = await passkey(() =>
      navigator.credentials.create({
        publicKey: {
          rp: { name: RP_NAME },
          user: { id: fromBase64url(options.user!) as Uint8Array<ArrayBuffer>, name: 'Your heroes', displayName: 'Your heroes' },
          challenge: fromBase64url(options.challenge) as Uint8Array<ArrayBuffer>,
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
          attestation: 'none',
          timeout: PASSKEY_TIMEOUT_MS,
        },
      }),
    );
    const response = credential.response as AuthenticatorAttestationResponse;
    const publicKey = response.getPublicKey?.();
    if (!publicKey || !response.getAuthenticatorData) throw new CloudError('unsupported', 'This browser cannot share the passkey with the cloud');
    const answer = {
      token: options.token,
      credential: base64url(new Uint8Array(credential.rawId)),
      publicKey: base64url(new Uint8Array(publicKey)),
      algorithm: response.getPublicKeyAlgorithm(),
      clientData: base64url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: base64url(new Uint8Array(response.getAuthenticatorData())),
    };
    return this.json<Session>(await this.call('POST', '/v1/register', { auth: false, body: JSON.stringify(answer), headers: { 'Content-Type': 'application/json' } }));
  }

  /** Signs in with a passkey this device (or a phone nearby) holds; returns its session. */
  async login(): Promise<Session> {
    if (!passkeysSupported()) throw new CloudError('unsupported', 'This browser cannot use passkeys');
    const options = await this.json<Challenge>(await this.call('POST', '/v1/login/options', { auth: false }));
    const credential = await passkey(() =>
      navigator.credentials.get({
        publicKey: { challenge: fromBase64url(options.challenge) as Uint8Array<ArrayBuffer>, userVerification: 'preferred', timeout: PASSKEY_TIMEOUT_MS },
      }),
    );
    const response = credential.response as AuthenticatorAssertionResponse;
    const answer = {
      token: options.token,
      credential: base64url(new Uint8Array(credential.rawId)),
      clientData: base64url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: base64url(new Uint8Array(response.authenticatorData)),
      signature: base64url(new Uint8Array(response.signature)),
      ...(response.userHandle ? { userHandle: base64url(new Uint8Array(response.userHandle)) } : {}),
    };
    const result = await this.call('POST', '/v1/login', { auth: false, body: JSON.stringify(answer), headers: { 'Content-Type': 'application/json' } });
    if (result.status === 404) throw new CloudError('auth', 'This passkey has no cloud account. Its data may have been deleted.', 404);
    return this.json<Session>(result);
  }
}

/** Runs a passkey ceremony, telling a cancel from a failure. */
async function passkey(run: () => Promise<Credential | null>): Promise<PublicKeyCredential> {
  let credential: Credential | null;
  try {
    credential = await run();
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') throw new CloudError('cancelled', 'The passkey was not used');
    if (name === 'NotSupportedError' || name === 'SecurityError') throw new CloudError('unsupported', `Passkeys are not available here (${name})`);
    throw new CloudError('server', `The passkey failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!credential || credential.type !== 'public-key') throw new CloudError('cancelled', 'No passkey was given');
  return credential as PublicKeyCredential;
}
