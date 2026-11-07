/** Cloud sync's pop-ups: the title's Cloud & backup menu, turning sync on, and the questions a sync asks. */
import { CloudError } from '../cloud/client.ts';
import { deviceName, type CloudSync, type JourneyChoice, type JourneySide } from '../cloud/sync.ts';
import type { Lease } from '../cloud/protocol.ts';
import { el } from './dom.ts';
import { confirmSheet, menuContent, openMessage, type MenuItem } from './menus.ts';
import type { SheetContent, Sheets } from './sheet.ts';

/** Another device by its name, "other iPhone" when this one has the same name. */
export function otherDevice(lease: Lease): string {
  return lease.name === deviceName() ? `other ${lease.name}` : lease.name;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** A moment by the clock: "today, 14:02", "yesterday, 09:15", "Sat 7 Nov, 14:02". */
export function clockTime(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** What the cloud is doing, in a few words. */
export function cloudLine(cloud: CloudSync, now = Date.now()): string {
  const { state, synced, message } = cloud.status;
  switch (state) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return `Offline. ${message}`;
    case 'signedOut':
      return message;
    case 'error':
      return `Could not sync: ${message}`;
    default:
      return synced ? `Synced ${ago(now - synced)}` : 'On';
  }
}

interface CloudMenuDeps {
  sheets: Sheets;
  cloud: CloudSync;
  /** The backup rows (export, import). */
  backup: MenuItem[];
  /** Turned on: the title's sync follows. */
  synced(): void;
  toast(text: string): void;
}

/** The title's Cloud & backup menu; it follows the cloud's status while open (`refresh`). */
export class CloudMenu {
  private readonly deps: CloudMenuDeps;
  private shown: SheetContent | null = null;

  constructor(deps: CloudMenuDeps) {
    this.deps = deps;
  }

  open(): void {
    this.shown = this.content();
    this.deps.sheets.open(this.shown);
  }

  /** Rebuilds the menu in place when it is showing. */
  refresh(): void {
    if (!this.shown) return;
    const next = this.content();
    this.deps.sheets.update(next, this.shown);
    this.shown = next;
  }

  private content(): SheetContent {
    const { cloud, sheets } = this.deps;
    const items: MenuItem[] = [];
    if (cloud.enabled) {
      items.push(
        {
          label: 'Sync now',
          icon: '☁',
          hint: cloudLine(cloud),
          run: () => {
            sheets.closeAll();
            void cloud.syncAtTitle(true).then(() => this.deps.toast(cloudLine(cloud)));
          },
        },
        {
          label: 'Turn off on this device',
          icon: '⏻',
          hint: 'Your heroes stay here',
          run: () =>
            confirmSheet(sheets, 'Turn off cloud sync?', 'Your heroes stay on this device and in the cloud, but stop syncing here. You can turn it on again by signing in.', 'Turn off', () => {
              sheets.back();
              cloud.turnOff();
              this.deps.toast('Cloud sync is off on this device');
            }),
        },
        {
          label: 'Delete cloud data',
          icon: '✕',
          danger: true,
          hint: 'Every device loses its copy in the cloud',
          run: () =>
            confirmSheet(
              sheets,
              'Delete your cloud data?',
              'Every hero, the Hall of Fame and your deeds are deleted from the cloud, for all your devices. What is on each device stays there. Your passkey can then be removed in your passwords.',
              'Delete',
              () => {
                sheets.back();
                cloud.deleteCloud().then(
                  () => this.deps.toast('Your cloud data was deleted'),
                  (err) => openMessage(sheets, 'Could not delete', err instanceof Error ? err.message : String(err)),
                );
              },
              true,
            ),
        },
      );
    } else if (cloud.status.state === 'signedOut') {
      items.push({ label: 'Sign in again', icon: '☁', hint: cloud.status.message, run: () => this.turnOn(true) });
    } else {
      items.push({ label: 'Turn on cloud sync', icon: '☁', hint: 'Play on all your devices', run: () => openTurnOn(sheets, (existing) => this.turnOn(existing)) });
    }
    items.push(...this.deps.backup);
    const content = menuContent(
      'Cloud & backup',
      items,
      cloud.enabled ? 'Your heroes, the Hall of Fame and your deeds are kept in step across your devices.' : 'Your heroes, the Hall of Fame and your deeds live in this browser.',
    );
    return { ...content, onClose: () => (this.shown = null) };
  }

  /** Signs in with a new passkey or one saved on another device, then syncs. */
  turnOn(existing: boolean): void {
    const { cloud, sheets } = this.deps;
    cloud.turnOn(existing).then(
      () => {
        sheets.closeAll();
        this.deps.toast('Cloud sync is on');
        this.deps.synced();
      },
      (err) => {
        if (err instanceof CloudError && err.kind === 'cancelled') return;
        openMessage(sheets, 'Cloud sync was not turned on', err instanceof Error ? err.message : String(err));
      },
    );
  }
}

/** Offers sync with a passkey: a new one, or the one saved on another device; `notNow` makes it a one-off suggestion. */
export function openTurnOn(sheets: Sheets, turnOn: (existing: boolean) => void, notNow?: () => void): void {
  const body = el('div', 'prose cloud-offer');
  body.append(
    el('p', undefined, 'Play on your phone, tablet or computer and pick up where you left off. If this device is lost, your heroes are safe.'),
    el('p', 'muted', 'Sync uses a passkey: no name, email or password. On Apple devices iCloud Keychain keeps it, so your other devices can use it too. Already syncing on another device? Choose Sign in.'),
  );
  sheets.open({
    title: 'Keep your heroes in sync',
    body,
    kind: 'card',
    className: 'sheet-cloud',
    onClose: notNow,
    actions: [
      ...(notNow ? [{ id: 'not-now', label: 'Not now', run: () => sheets.back() }] : []),
      { id: 'sign-in', label: 'Sign in', run: () => turnOn(true) },
      { id: 'turn-on', label: 'Turn on', primary: true, run: () => turnOn(false) },
    ],
  });
}

function side(where: string, facts: JourneySide, synced: number | undefined): HTMLElement {
  const column = el('div', `journey-side${facts.fallen ? ' fallen' : ''}`);
  column.append(el('h3', undefined, where));
  const list = el('dl', 'hero-facts');
  const fact = (label: string, value: string | undefined) => {
    if (value) list.append(el('dt', undefined, label), el('dd', undefined, value));
  };
  const saved = facts.saved ? Date.parse(facts.saved) : NaN;
  fact('Hero', facts.line);
  fact('Where', facts.place);
  fact('Saved', Number.isFinite(saved) ? clockTime(saved) : undefined);
  fact('Synced', synced ? clockTime(synced) : undefined);
  fact('State', facts.fallen ? 'Fallen' : 'Alive');
  column.append(list);
  return column;
}

/** "Which journey continues?": a hero changed both here and on another device since they last met. */
export function chooseJourney(sheets: Sheets, choice: JourneyChoice): Promise<'local' | 'remote' | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: 'local' | 'remote' | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = el('div', 'journey');
    const there = choice.remote.where === 'The cloud' ? 'another device' : `your ${choice.remote.where.replace(/^Other /, 'other ')}`;
    const since = choice.inStep ? `they were last in sync, ${clockTime(choice.inStep)}` : 'they were last in sync';
    body.append(el('p', undefined, `${choice.hero} was played here and on ${there} since ${since}. One journey goes on; the other is lost.`));
    const sides = el('div', 'journey-sides');
    sides.append(side(choice.local.where, choice.local, choice.inStep), side(choice.remote.where, choice.remote, choice.remote.sent));
    body.append(sides);
    const keep = (where: string) => `Keep ${where.replace(/^(This|Other|The) /, (w) => w.toLowerCase())}'s`;
    sheets.open({
      title: 'Which journey continues?',
      body,
      kind: 'card',
      className: 'sheet-journey',
      onClose: () => finish(null),
      actions: [
        { id: 'keep-remote', label: keep(choice.remote.where), primary: choice.suggested === 'remote', run: () => (finish('remote'), sheets.back()) },
        { id: 'keep-local', label: keep(choice.local.where), primary: choice.suggested === 'local', run: () => (finish('local'), sheets.back()) },
      ],
    });
  });
}

/** A hero another device is playing now: take them here? */
export function confirmTakeover(sheets: Sheets, hero: string, lease: Lease, ageMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = el('div', 'prose');
    const there = otherDevice(lease);
    body.append(
      el('p', undefined, `${hero} was being played on your ${there}, which last synced ${clockTime(Date.now() - ageMs)} (${ago(ageMs)}).`),
      el('p', undefined, `Continue here instead? Anything since their last save on the ${there} will be lost.`),
    );
    sheets.open({
      title: `${hero} is in play on your ${there}`,
      body,
      kind: 'card',
      onClose: () => finish(false),
      actions: [
        { id: 'cancel', label: 'Cancel', run: () => (finish(false), sheets.back()) },
        { id: 'continue-here', label: 'Continue here', primary: true, run: () => (finish(true), sheets.back()) },
      ],
    });
  });
}

/** The hero in play was taken up on another device: back to the title, where their journey there is brought in. */
export function openLost(sheets: Sheets, hero: string, lease: Lease, back: () => void): void {
  const body = el('div', 'prose');
  const there = otherDevice(lease);
  body.append(el('p', undefined, `Your ${there} has taken ${hero} up. This game is saved and set aside, and the title screen brings in ${hero}'s journey from there.`));
  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    back();
  };
  sheets.closeAll();
  sheets.open({
    title: `${hero} continued on your ${there}`,
    body,
    kind: 'card',
    onClose: leave,
    actions: [{ id: 'to-title', label: 'Back to title', primary: true, run: leave }],
  });
}
