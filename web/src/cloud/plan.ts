/**
 * What a sync does, worked out from three lists of files: this device's, the
 * cloud's, and those both had at the last sync (`base`). Pure: the controller
 * (`sync.ts`) reads and writes the files.
 */
import type { CloudFile, Lease, Manifest } from './protocol.ts';

export type FileList = Record<string, CloudFile>;

/** Files every hero shares, merged rather than taken from one side (see `merge.ts`). */
export const SHARED_FILES = ['global.svg', 'scores.raw', 'adventurers.json', 'chronicle.json', 'mapmemory.json'] as const;
export type SharedFile = (typeof SHARED_FILES)[number];

/** How long a lease of a hero being played counts as someone playing them now. */
export const FRESH_LEASE_MS = 10 * 60 * 1000;

export function sharedFile(path: string): SharedFile | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (SHARED_FILES as readonly string[]).includes(name) ? (name as SharedFile) : null;
}

/** The hero (savefile name) a file belongs to: the savefile, its lives and kept levels (`save/Base`, `save/Base.lvl4_2`), and its notes (`Base.nte`). */
export function heroOf(path: string): string | null {
  const save = /(?:^|\/)save\/([A-Za-z0-9_]+)(?:\.[^/]+)?$/.exec(path);
  if (save) return path.endsWith('/global.svg') ? null : save[1];
  return /(?:^|\/)([A-Za-z0-9_]+)\.nte$/.exec(path)?.[1] ?? null;
}

/** How a file differs: the same on both sides, changed here only, in the cloud only, or on both. */
export type Change = 'same' | 'local' | 'remote' | 'both';

export function change(path: string, local: FileList, remote: FileList, base: FileList): Change {
  const l = local[path]?.hash ?? null;
  const r = remote[path]?.hash ?? null;
  const b = base[path]?.hash ?? null;
  if (l === r) return 'same';
  if (l === b) return 'remote';
  if (r === b) return 'local';
  return 'both';
}

export interface HeroChange {
  base: string;
  /** Changed here since the last sync. */
  local: boolean;
  /** Changed in the cloud since the last sync. */
  remote: boolean;
  /** No file of the hero is left here (deleted). */
  localGone: boolean;
  /** No file of the hero is left in the cloud (deleted on another device). */
  remoteGone: boolean;
}

/** Every path in any of the lists. */
export function allPaths(...lists: FileList[]): string[] {
  return [...new Set(lists.flatMap((l) => Object.keys(l)))].sort();
}

/** Each hero whose files differ between here and the cloud, with which side changed them. */
export function heroChanges(local: FileList, remote: FileList, base: FileList): HeroChange[] {
  const heroes = new Map<string, HeroChange>();
  for (const path of allPaths(local, remote, base)) {
    const hero = heroOf(path);
    if (!hero) continue;
    const c = change(path, local, remote, base);
    if (c === 'same') continue;
    const entry = heroes.get(hero) ?? { base: hero, local: false, remote: false, localGone: true, remoteGone: true };
    if (c === 'local' || c === 'both') entry.local = true;
    if (c === 'remote' || c === 'both') entry.remote = true;
    heroes.set(hero, entry);
  }
  for (const [path] of Object.entries(local)) {
    const entry = heroes.get(heroOf(path) ?? '');
    if (entry) entry.localGone = false;
  }
  for (const [path] of Object.entries(remote)) {
    const entry = heroes.get(heroOf(path) ?? '');
    if (entry) entry.remoteGone = false;
  }
  return [...heroes.values()];
}

/**
 * Whose copy of a changed hero is kept: the one `chosen` (by the player, or
 * the cloud's for a hero taken up on another device during a game here), else
 * the side that changed them; changed on both, the one still there when the
 * other side deleted the hero, else the cloud's when another device took the
 * hero from this one (the player said so there) while this one held them at
 * the last sync (`known`, the lease then); null when the player must choose.
 */
export function heroWinner(hero: HeroChange, lease: Lease | undefined, device: string, chosen: ReadonlyMap<string, 'local' | 'remote'>, known?: Lease): 'local' | 'remote' | null {
  const choice = chosen.get(hero.base);
  if (choice) return choice;
  if (!hero.remote) return 'local';
  if (!hero.local) return 'remote';
  if (hero.localGone !== hero.remoteGone) return hero.localGone ? 'remote' : 'local';
  if (lease && known && lease.device !== device && lease.over === device && known.device === device && lease.at > known.at) return 'remote';
  return null;
}

/** What a full sync does to the files here: those to fetch, to delete, and the shared ones to merge. */
export interface FullPlan {
  fetch: string[];
  remove: string[];
  /** Shared files to merge: changed on both sides, or on the side whose copy of a hero was not kept. */
  merge: string[];
}

/**
 * A full sync (on the title screen, nothing in play), once every changed hero
 * has a winner: a hero's files come from the copy kept, other files from the
 * side that changed them (this device's when both did); shared files are
 * merged when both changed them or a side's changes to a hero were overruled.
 */
export function fullPlan(local: FileList, remote: FileList, base: FileList, heroes: readonly HeroChange[], winner: (hero: string) => 'local' | 'remote' | null): FullPlan {
  const plan: FullPlan = { fetch: [], remove: [], merge: [] };
  const overruled = new Set<Change>();
  for (const hero of heroes) {
    const side = winner(hero.base);
    if (side === 'remote' && hero.local) overruled.add('local');
    if (side === 'local' && hero.remote) overruled.add('remote');
  }
  for (const path of allPaths(local, remote, base)) {
    const c = change(path, local, remote, base);
    if (c === 'same') continue;
    if (sharedFile(path) && (c === 'both' || overruled.has(c))) {
      plan.merge.push(path);
      continue;
    }
    const hero = heroOf(path);
    const take = (hero && winner(hero)) || (c === 'remote' ? 'remote' : 'local');
    if (take === 'local') continue;
    if (remote[path]) plan.fetch.push(path);
    else plan.remove.push(path);
  }
  return plan;
}

/**
 * The files a push from a game in progress commits: each file changed here
 * only, unless its hero has changed in the cloud too or is `skip` (taken up on
 * another device); those wait for the title screen, as do files changed on
 * both sides, and the shared files while any hero waits (they hold its
 * entries, which must follow the copy kept).
 */
export function pushFiles(local: FileList, remote: FileList, base: FileList, skip: string | null): { files: FileList; pushed: string[] } {
  const files: FileList = { ...remote };
  const pushed: string[] = [];
  const held = new Set(heroChanges(local, remote, base).filter((h) => h.remote).map((h) => h.base));
  if (skip) held.add(skip);
  for (const path of allPaths(local, remote, base)) {
    if (change(path, local, remote, base) !== 'local') continue;
    const hero = heroOf(path);
    if (hero ? held.has(hero) : held.size > 0 && sharedFile(path)) continue;
    if (local[path]) files[path] = local[path];
    else delete files[path];
    pushed.push(path);
  }
  return { files, pushed };
}

/** Leases of heroes that still have files. */
export function keptLeases(heroes: Manifest['heroes'], files: FileList): Manifest['heroes'] {
  const present = new Set(Object.keys(files).map(heroOf).filter((h): h is string => !!h));
  const out: Manifest['heroes'] = {};
  for (const [hero, lease] of Object.entries(heroes)) if (present.has(hero)) out[hero] = lease;
  return out;
}

/** True when another device has taken up the hero since `since` (server time). */
export function takenElsewhere(lease: Lease | undefined, device: string, since: number): boolean {
  return !!lease && lease.device !== device && lease.at > since;
}

/** True when another device is playing the hero now. */
export function playingElsewhere(lease: Lease | undefined, device: string, now: number): boolean {
  return !!lease && lease.device !== device && lease.playing && now - lease.at < FRESH_LEASE_MS;
}
