import { isHostile, type GameState, type MonsterState, type PlayerState } from '../render/snapshot.ts';

export type Element = 'fire' | 'cold' | 'lightning' | 'poison' | 'magic' | 'dark' | 'earth';

export type CueId =
  | 'hit'
  | 'crit'
  | 'miss'
  | 'hurt'
  | 'claw'
  | 'bite'
  | 'parry'
  | 'kill'
  | 'kill-unique'
  | 'impact'
  | 'door-open'
  | 'door-close'
  | 'door-bash'
  | 'door-locked'
  | 'unlock'
  | 'distant-door'
  | 'stairs-down'
  | 'stairs-up'
  | 'travel'
  | 'pickup'
  | 'gold'
  | 'buy'
  | 'levelup'
  | 'learn'
  | 'quaff'
  | 'read'
  | 'eat'
  | 'cast'
  | 'fire'
  | 'throw'
  | 'zap'
  | 'activate'
  | 'wield'
  | 'takeoff'
  | 'drop'
  | 'fuel'
  | 'disarm'
  | 'tunnel'
  | 'heal'
  | 'teleport'
  | 'trap'
  | 'secret'
  | 'rumble'
  | 'breath'
  | 'spell-monster'
  | 'shriek'
  | 'danger'
  | 'unique'
  | 'death'
  | 'shop'
  | 'deny'
  | 'poisoned'
  | 'confused'
  | 'hallucinate'
  | 'blind'
  | 'paralyzed'
  | 'afraid'
  | 'stun'
  | 'cut'
  | 'haste'
  | 'slow'
  | 'cured'
  | 'hungry'
  | 'bolt'
  | 'explosion'
  | 'heartbeat'
  | 'ui-open'
  | 'ui-close'
  | 'quest'
  | 'save';

export interface Cue {
  id: CueId;
  /** 0..1, how hard or how much. */
  strength?: number;
  element?: Element;
  /** Grid distance from the player, for sounds heard rather than made. */
  distance?: number;
}

/** Messages newer than the previous state, oldest first, without repeat counts. */
export function freshMessages(prev: Pick<GameState, 'messageTotal' | 'messages'> | null, next: Pick<GameState, 'messageTotal' | 'messages'>): string[] {
  const messages = next.messages ?? [];
  if (!prev) return [];
  const added = Math.max(0, (next.messageTotal ?? 0) - (prev.messageTotal ?? 0));
  let count = Math.min(messages.length, added);
  /* A repeated message is merged into the newest one with a count. */
  if (count === 0 && messages[0] && prev.messages?.[0] && messages[0].text !== prev.messages[0].text) count = 1;
  return messages
    .slice(0, count)
    .reverse()
    .map((m) => m.text.replace(/\s*\(x\d+\)\s*$/, ''));
}

const ELEMENT_WORDS: [RegExp, Element][] = [
  [/fire|flame|burn|plasma|lava/i, 'fire'],
  [/frost|cold|ice/i, 'cold'],
  [/lightning|electric|thunder/i, 'lightning'],
  [/acid|poison|stinking|disease|toxic/i, 'poison'],
  [/dark|nether|shadow|death|time/i, 'dark'],
  [/earth|shards|rocks|gravity|inertia|sound/i, 'earth'],
];

export function elementFromText(text: string): Element {
  for (const [pattern, element] of ELEMENT_WORDS) if (pattern.test(text)) return element;
  return 'magic';
}

/** tome2 colours (TERM_*) to the element a bolt of that colour most likely is. */
export function elementFromColour(attr: number): Element {
  switch (attr & 0x0f) {
    case 3:
    case 4:
    case 12:
      return 'fire';
    case 1:
    case 6:
    case 9:
    case 14:
      return 'cold';
    case 11:
      return 'lightning';
    case 5:
    case 13:
      return 'poison';
    case 0:
    case 2:
    case 8:
      return 'dark';
    case 7:
    case 15:
      return 'earth';
    default:
      return 'magic';
  }
}

const HURT_VERBS = /\b(hits|touches|punches|kicks|butts|crushes|engulfs|charges|crawls on|stings) you\b/;

/** Sounds for one message, if it describes something with a sound. */
export function messageCues(text: string): Cue[] {
  if (/^You die\b/.test(text)) return [{ id: 'death' }];
  if (/^You have (slain|destroyed|killed)\b/.test(text)) return [{ id: 'kill' }];
  if (/^It was a (good|great|superb|\*great\*|\*superb\*) hit/i.test(text)) return [{ id: 'crit' }];
  if (/^You (hit|punch|kick|strike|smite|slash|bash|bite|claw|stab|pierce|crush|knee|elbow|butt)\b/.test(text)) return [{ id: 'hit' }];
  if (/^You miss\b/.test(text)) return [{ id: 'miss' }];
  if (/\bmisses you\b/.test(text)) return [{ id: 'parry' }];
  if (/\bbites you\b/.test(text)) return [{ id: 'bite' }];
  if (/\bclaws you\b/.test(text)) return [{ id: 'claw' }];
  if (HURT_VERBS.test(text)) return [{ id: 'hurt' }];
  if (/\b(dies|is destroyed)\.$/.test(text)) return [{ id: 'kill' }];
  if (/\bbreathes\b/.test(text)) return [{ id: 'breath', element: elementFromText(text) }];
  if (/\b(casts|invokes|gestures|mumbles|concentrates|points)\b/.test(text) && !/^You\b/.test(text)) return [{ id: 'spell-monster' }];
  if (/\b(shrieks|screams|makes a high[- ]pitched shriek)\b/.test(text)) return [{ id: 'shriek' }];
  if (/^You hear a door burst open/.test(text)) return [{ id: 'distant-door' }];
  if (/^The door crashes open/.test(text)) return [{ id: 'door-bash' }];
  if (/^The door holds firm|appears to be stuck/.test(text)) return [{ id: 'impact', strength: 0.5 }];
  if (/^You failed to pick the lock/.test(text)) return [{ id: 'door-locked' }];
  if (/^You have picked the lock|^You have disarmed/.test(text)) return [{ id: 'unlock' }];
  if (/^You have found a secret door|^You have found a trap|^You found a way out/.test(text)) return [{ id: 'secret' }];
  if (/^You have learned the ability|^You can learn/.test(text)) return [{ id: 'learn' }];
  if (/^You feel (better|much better|very good)/.test(text)) return [{ id: 'heal' }];
  if (/^You have no room/.test(text)) return [{ id: 'deny' }];
  if (/^You have (?!no more).* \([a-z]\)\.$/.test(text)) return [{ id: 'pickup' }];
  if (/^You feel something roll beneath your feet/.test(text)) return [{ id: 'drop' }];
  if (/\b(trap door|fall through|fall into a pit|set off|dart hits you|enveloped in|pit of spikes|rune of)\b/i.test(text)) return [{ id: 'trap' }];
  if (/\b(ground|cave|dungeon|earth) (shakes|rumbles|quakes)|earthquake/i.test(text)) return [{ id: 'rumble' }];
  if (/^You (feel yourself yanked|float gently|rise up through|sink through|deep breath)|teleport/i.test(text)) return [{ id: 'teleport' }];
  if (/^You are (getting )?(hungry|weak)\b/.test(text)) return [{ id: 'hungry' }];
  if (/\bquest\b.*\b(completed|done|finished)\b|^You have completed/i.test(text)) return [{ id: 'quest' }];
  return [];
}

/** Command keys (original keyset) and the sound once the action has taken game time. */
const INTENT_CUES: Readonly<Record<string, CueId>> = {
  q: 'quaff',
  r: 'read',
  E: 'eat',
  m: 'cast',
  p: 'cast',
  f: 'fire',
  v: 'throw',
  a: 'zap',
  u: 'zap',
  z: 'zap',
  A: 'activate',
  w: 'wield',
  t: 'takeoff',
  d: 'drop',
  F: 'fuel',
  D: 'disarm',
  T: 'tunnel',
};

export function intentCue(key: string): Cue | null {
  const id = INTENT_CUES[key];
  return id ? { id } : null;
}

type Tracked = Pick<PlayerState, 'name' | 'lev' | 'au' | 'chp' | 'mhp' | 'depth' | 'dungeon' | 'wild' | 'status' | 'food'>;

const STATUS_CUES: [string, CueId][] = [
  ['poisoned', 'poisoned'],
  ['confused', 'confused'],
  ['blind', 'blind'],
  ['paralyzed', 'paralyzed'],
  ['afraid', 'afraid'],
  ['stun', 'stun'],
  ['cut', 'cut'],
  ['hallucinating', 'hallucinate'],
  ['fast', 'haste'],
  ['slow', 'slow'],
];
const AILMENTS = ['poisoned', 'confused', 'blind', 'paralyzed', 'afraid', 'stun', 'cut', 'hallucinating'];

/**
 * Sounds for changes in the player's state. `heard` lists cues already
 * found in messages, so the same event is not played twice.
 */
export function playerCues(prev: Tracked | null, next: Tracked, heard: ReadonlySet<CueId>, inStore: boolean): Cue[] {
  if (!prev || prev.name !== next.name) return [];
  const cues: Cue[] = [];
  const moved = next.depth !== prev.depth || next.dungeon !== prev.dungeon || next.wild !== prev.wild;
  if (moved) {
    if (next.wild !== prev.wild) cues.push({ id: 'travel' });
    else cues.push({ id: next.depth > prev.depth ? 'stairs-down' : 'stairs-up' });
  }
  if (next.lev > prev.lev) cues.push({ id: 'levelup' });
  if (!moved && next.mhp > 0) {
    const lost = prev.chp - next.chp;
    const gained = next.chp - prev.chp;
    if (lost > 0 && !['hurt', 'bite', 'claw', 'trap', 'death'].some((id) => heard.has(id as CueId))) {
      cues.push({ id: 'hurt', strength: Math.min(1, lost / next.mhp + 0.2) });
    }
    if (gained > next.mhp * 0.15 && next.lev === prev.lev && !heard.has('heal')) cues.push({ id: 'heal' });
  }
  if (next.au > prev.au && !moved) cues.push({ id: 'gold', strength: Math.min(1, Math.log10(next.au - prev.au + 1) / 3) });
  if (next.au < prev.au && inStore) cues.push({ id: 'buy' });
  for (const [key, id] of STATUS_CUES) {
    if ((next.status[key] ?? 0) > 0 && !((prev.status[key] ?? 0) > 0)) cues.push({ id });
  }
  const wasIll = AILMENTS.some((k) => (prev.status[k] ?? 0) > 0);
  const isIll = AILMENTS.some((k) => (next.status[k] ?? 0) > 0);
  if (wasIll && !isIll && next.chp > 0) cues.push({ id: 'cured' });
  return cues;
}

/** Door features, by f_info index, from the feature table. */
export interface DoorKinds {
  closed: ReadonlySet<number>;
  open: ReadonlySet<number>;
  broken: ReadonlySet<number>;
}

export function doorKinds(features: readonly { name: string; flags: number }[], doorFlag: number, noWalkFlag: number): DoorKinds {
  const closed = new Set<number>();
  const open = new Set<number>();
  const broken = new Set<number>();
  features.forEach((f, i) => {
    if (!(f.flags & doorFlag)) return;
    if (/broken/i.test(f.name)) broken.add(i);
    else if (f.flags & noWalkFlag) closed.add(i);
    else open.add(i);
  });
  return { closed, open, broken };
}

/** Doors that opened, closed or broke near the player between two snapshots of the same level. */
export function doorCues(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  px: number,
  py: number,
  doors: DoorKinds,
  hearing = 20,
): Cue[] {
  const cues: Cue[] = [];
  if (before.length !== after.length || !width) return cues;
  for (let i = 0; i < after.length; i++) {
    const a = before[i];
    const b = after[i];
    if (a === b) continue;
    const distance = Math.max(Math.abs((i % width) - px), Math.abs(Math.floor(i / width) - py));
    if (distance > hearing) continue;
    let id: CueId | null = null;
    if (doors.closed.has(a) && doors.open.has(b)) id = 'door-open';
    else if (doors.open.has(a) && doors.closed.has(b)) id = 'door-close';
    else if (doors.closed.has(a) && doors.broken.has(b)) id = 'door-bash';
    if (id) cues.push({ id, distance: distance <= 1 ? 0 : distance });
    if (cues.length >= 3) break;
  }
  return cues;
}

/**
 * How threatening the visible creatures are, 0..1: tougher, nearer, awake
 * and unique foes count for more, and low health raises the stakes.
 */
export function danger(player: Pick<PlayerState, 'lev' | 'chp' | 'mhp'>, monsters: readonly MonsterState[], py: number, px: number): number {
  let sum = 0;
  for (const m of monsters) {
    if (!isHostile(m)) continue;
    const level = m.level ?? player.lev;
    const toughness = Math.max(0.15, Math.min(1.6, (level - player.lev * 0.8 + 8) / 16));
    const distance = Math.max(Math.abs(m.x - px), Math.abs(m.y - py));
    const near = distance <= 2 ? 1 : distance <= 6 ? 0.6 : 0.3;
    sum += toughness * near * (m.unique ? 1.8 : 1) * (m.asleep ? 0.3 : 1);
  }
  const health = player.mhp > 0 ? player.chp / player.mhp : 1;
  const threat = 1 - Math.exp(-sum * 0.7);
  return Math.min(1, threat * (health < 0.5 ? 1.3 : 1));
}

/** Newly seen foes worth a musical warning: uniques that are a match for the player, and creatures far above the player's level. */
export function newThreats(prev: readonly MonsterState[], next: readonly MonsterState[], playerLevel: number, announced: ReadonlySet<number>): { unique: MonsterState[]; strong: MonsterState[] } {
  const seen = new Set(prev.map((m) => m.id));
  const unique: MonsterState[] = [];
  const strong: MonsterState[] = [];
  for (const m of next) {
    if (seen.has(m.id) || announced.has(m.id) || !isHostile(m) || m.asleep) continue;
    const level = m.level ?? 0;
    if (m.unique && level >= Math.max(4, playerLevel - 5)) unique.push(m);
    else if (level >= playerLevel + 8 || (level >= playerLevel * 1.6 && playerLevel >= 5)) strong.push(m);
  }
  return { unique, strong };
}
