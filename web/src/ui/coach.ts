import { el, iconText } from './dom.ts';

const STORAGE_KEY = 'tome2mobile.coach.v1';
/* Game turns of play after which the tips have done their job. */
const COACH_TURNS = 400;

const TIPS: [string, string][] = [
  ['⇢', 'Explore finds new places and stops when something needs you.'],
  ['◎', 'Tap the map to walk there; tap a creature next to you, or Attack, to fight it.'],
  ['◉', 'Press and hold anything to see what it is. Drag to look around.'],
];

function seen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* Storage is unavailable; the tips show again next time. */
  }
}

/**
 * First-game tips over the top of the map. They never block play, close
 * with "Got it", and retire on their own after a little play.
 */
export class Coach {
  private readonly root: HTMLElement;
  private firstTurn = -1;
  private done = seen();

  constructor(stage: HTMLElement) {
    this.root = el('div', 'coach');
    this.root.hidden = true;
    this.root.setAttribute('role', 'note');
    const list = el('ul', 'coach-tips');
    for (const [icon, text] of TIPS) {
      const item = el('li');
      item.append(el('span', 'coach-icon', iconText(icon)), el('span', undefined, text));
      list.append(item);
    }
    const close = el('button', 'coach-close', 'Got it');
    close.type = 'button';
    close.addEventListener('click', () => this.finish());
    this.root.append(el('p', 'coach-title', 'Welcome, adventurer'), list, close);
    stage.append(this.root);
  }

  /** Shows the tips while the map is in play, until they are done. */
  update(onMap: boolean, turn: number): void {
    if (this.done) return;
    if (this.firstTurn < 0 && onMap) this.firstTurn = turn;
    if (this.firstTurn >= 0 && turn - this.firstTurn > COACH_TURNS) {
      this.finish();
      return;
    }
    this.root.hidden = !onMap;
  }

  private finish(): void {
    this.done = true;
    this.root.hidden = true;
    remember();
  }
}
