# Syncing heroes between devices: where we stand

A brief for picking this up again. Read it with `AGENTS.md` (*Hero transfer*).

## The requirement

- Each player is responsible for their own data. The project hosts nothing for players, keeps none of their data and can never be billed for their use.
- Apple first (iPhone and iPad, the game added to the Home Screen), but any browser should work.
- It should feel natural: a hero picked up on another device where they were left, without accounts or set-up the player does not already have.

## What the game does now

Hero transfer, by the player, with no account or server:

- **Send** on a hero's card in the Game Roster makes a `.tome2hero` file and opens the share sheet (AirDrop, Messages, Save to Files), or downloads it where the browser has no share sheet.
- **Share & backup → Receive a hero** on the title screen adds that hero. The Hall of Fame, deeds and fallen heroes are combined; other heroes on the device are left alone.
- If the device already has the hero as a different copy, *Which journey continues?* shows both (level, place, when saved, when sent) and the player chooses.
- Export and Import of everything stay for backups.

The building blocks below are reusable by any automatic sync:

- `play/transfer.ts` `heroOf`: which files belong to a hero (`save/Base`, `save/Base.*`, `Base.nte`).
- `play/merge.ts`: merging the five files every hero shares (`global.svg`, `scores.raw`, `adventurers.json`, `chronicle.json`, `mapmemory.json`). A hero's entries follow the copy kept; the rest is combined. It is two-way: an automatic sync would want three-way merges against the copy both sides last had, so counts can be added rather than maxed.
- `ui/transfer.ts`: the *Which journey continues?* card and `clockTime`.
- `restartTitle` in `main.ts`: tome2 reads its savefile list once, at its start screen, so new files on the title need the title started again (Escape at tome2's savefile screen, a fresh engine in the same page).

## What was tried and removed

PR #57 built automatic sync on a Cloudflare Worker over R2, with passkey sign-in. It worked in tests, but the project would host every player's saves and could be billed for their use (R2 bills beyond its free allowance once a card is on the account, with no hard spending cap). It was removed before it went live. The code is in the history (merge commit `c640ec5`) and holds ideas worth keeping:

- **Three-way sync of files by hash** against the last synced list: a file changed on one side takes that side; a hero changed on both asks the journey question; the shared files are merged.
- **Leases**, saying which device is playing a hero, so continuing them elsewhere asks first (*Elder is in play on your iPhone*) and the first device gives way (*Elder continued on your iPad*).
- **Sync points**: before tome2 reads its saves (an engine hook awaited in `web_mount_storage`), on the title, before Continue, and during a game after each save that changed a file (a cheap fingerprint of file sizes and times), plus when the page is hidden.

## Options for automatic sync, each player using their own storage

| Option | Player needs | The project needs | Notes |
|---|---|---|---|
| **Dropbox app folder** | A Dropbox account | A free Dropbox app (a public client ID in the build). Up to 500 players in development status; once 50 have linked, production approval within two weeks | OAuth with PKCE from the page, no secret. Uploads can be conditional on the file's revision (`mode: update`), which gives the compare-and-swap a sync needs |
| **Google Drive app data folder** | A Google account | A free Google Cloud OAuth client and consent screen. `drive.appdata` is a non-sensitive scope (basic verification) | Without a server there is no refresh token: access lasts about an hour, then the player is asked again (silently when signed in to Google). No conditional writes, so concurrent writes need another plan (a file per device, or last writer wins with the journey question) |
| **iCloud (CloudKit JS)** | An Apple ID | The Apple Developer Program (US$99 a year) and a CloudKit container | Data in the player's own iCloud, counted against their iCloud storage. Sign-in is a pop-up; whether it works in a Home Screen web app is unknown and must be tested on a device first |
| **GitHub Gist** | A GitHub account and a personal access token | Nothing | For technical players only. A secret gist is unlisted, not private |
| **File in iCloud Drive kept open** | — | — | Not possible: Safari has no File System Access API, so a page cannot keep writing to a file the player picked |

Before building any of them, check on a real iPhone, in the Home Screen app, that the provider's sign-in opens and returns to the game: OAuth pop-ups and redirects are the weak point of Home Screen web apps.

## Open questions for the owner

- Which provider, if any. Hero transfer may be enough.
- Whether a hero sent should stay playable on the sending device (as now: a copy) or be set aside there until it comes back (a move).
