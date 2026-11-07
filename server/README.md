# Cloud sync service

A Cloudflare Worker over an R2 bucket that keeps players' heroes in step across their devices. Players sign in with a passkey (Face ID, Touch ID, a device's lock): the service keeps no names, emails or passwords, only each passkey's public key and the saves.

- `src/worker.ts`: the whole service, with no dependencies. `web/src/cloud/protocol.ts` is shared with the app.
- Unit tests: `tests/unit/cloudserver.test.ts` (run with `npm test`). The e2e journey `tests/e2e/cloud.spec.ts` runs this same code against an in-memory bucket.

## API

| Method | Path | |
|---|---|---|
| POST | `/v1/register/options` | A challenge and a new account id for a passkey |
| POST | `/v1/register` | The new passkey's public key (checked against the challenge, origin and authenticator data); returns a session |
| POST | `/v1/login/options` | A challenge |
| POST | `/v1/login` | A passkey's signature; returns a session |
| GET | `/v1/sync` | The account's manifest (every file's SHA-256 and size, and each hero's lease), its ETag and the server's time |
| PUT | `/v1/sync` | A new manifest, `If-Match` the ETag read: 412 when another device wrote first, 409 with the blobs it lacks |
| PUT / GET | `/v1/blob/<sha256>` | A file, gzip-compressed (the hash is of its bytes; checked on upload) |
| DELETE | `/v1/account` | Everything the account keeps, and its passkeys |

Sessions and challenges are HMAC-signed tokens (`SESSION_SECRET`): sessions last 400 days and are renewed with a sync after 30. A file is at most 16 MB (refused while it is inflated, not after) and an account 200 MB as stored, uncommitted uploads included. Each commit deletes the blobs no manifest names once they are an hour old, so an upload for a commit still on its way stays. New accounts are limited to 10 a minute per address (`REGISTER_LIMIT`, Workers rate limiting, Wrangler 4.36 or later; loose, as it counts per Cloudflare location).

## Setting it up

You need a Cloudflare account (the free plan is enough) and Node.js. From this folder:

```zsh
npx wrangler login
npx wrangler r2 bucket create tome-cloud-saves
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

`wrangler deploy` prints the service's address, such as `https://tome-cloud.<you>.workers.dev`. Then, in the GitHub repository's **Settings → Secrets and variables → Actions → Variables**, add `CLOUD_URL` with that address. The next deploy of `main` builds the app with it (`VITE_CLOUD_URL`), and the title screen's *Backup* becomes *Cloud & backup*. Pull requests' builds never talk to it.

`ALLOWED_ORIGINS` in `wrangler.toml` lists where the app is served from. A passkey belongs to its origin's host name (`darrencroton.github.io`), so moving the app to another domain means players turn sync on again there.

To try a deployed service from a local build, or a build without `CLOUD_URL`, set it in the browser's console: `localStorage.setItem('tome2mobile.cloudUrl', 'https://…')`, then reload. Its origin must be in `ALLOWED_ORIGINS` (`http://localhost:5173` is).

## Costs

On Cloudflare's free plan: Workers allow 100,000 requests a day, and R2 10 GB of storage, a million writes and ten million reads a month, with no charge for downloads. A sync while playing is a read of the manifest, a write of it and one upload per changed file, a few times a level.
