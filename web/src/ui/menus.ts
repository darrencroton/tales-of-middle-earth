import { readableColour } from '../render/colour.ts';
import { isNotice, type MessageState } from '../render/snapshot.ts';
import type { VolumeLevel } from '../audio/audio.ts';
import type { ExplorePace } from '../play/actions.ts';
import {
  TEXT_SIZE_LABELS,
  TEXT_SIZE_PX,
  type AnimationLevel,
  type MessageFlow,
  type Settings,
  type TextSize,
} from '../settings.ts';
import type { GlyphMode } from '../render/appearance.ts';
import { MAX_ZOOM, MIN_ZOOM } from '../render/map.ts';
import { el, navButton, section } from './dom.ts';
import { runElements } from './adventure.ts';
import type { RunOptions } from '../flow/runoptions.ts';
import type { Sheets } from './sheet.ts';

export interface MenuItem {
  label: string;
  icon: string;
  hint?: string;
  danger?: boolean;
  hidden?: boolean;
  run(): void;
}

/** A sheet listing menu items as large rows. */
export function openMenu(sheets: Sheets, title: string, items: MenuItem[], subtitle?: string): void {
  const list = el('div', 'menu-list');
  for (const item of items) {
    if (item.hidden) continue;
    list.append(
      navButton(item.label, {
        icon: item.icon,
        hint: item.hint,
        className: `row-button${item.danger ? ' danger' : ''}`,
        onClick: item.run,
      }),
    );
  }
  sheets.open({ title, subtitle, body: list, kind: 'menu' });
}

/** A row of mutually exclusive buttons, the current one selected; `onChange` gets the value tapped. */
export function segmented<T extends string>(
  name: string,
  options: [T, string][],
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const group = el('div', 'segmented');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', name);
  for (const [value, label] of options) {
    const button = el('button', value === current ? 'segment selected' : 'segment', label);
    button.type = 'button';
    button.dataset.nav = '';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(value === current));
    button.addEventListener('click', () => {
      for (const b of group.querySelectorAll('.segment')) {
        b.classList.toggle('selected', b === button);
        b.setAttribute('aria-checked', String(b === button));
      }
      onChange(value);
    });
    group.append(button);
  }
  return group;
}

/** The rules a hero's adventure was begun with, shown at the foot of Settings during a game. */
export interface AdventureRules {
  hero: string;
  run: RunOptions;
}

/** Display settings, applied as they change; during a game, the adventure's own rules below them, which cannot change. */
export function openSettings(sheets: Sheets, settings: Settings, apply: (next: Settings) => void, rules?: AdventureRules | null): void {
  let current = { ...settings };
  const update = (patch: Partial<Settings>) => {
    current = { ...current, ...patch };
    apply(current);
  };
  const body = el('div', 'settings');

  const sizes = Object.keys(TEXT_SIZE_PX) as TextSize[];
  const textSize = segmented<TextSize>('Text size', sizes.map((s) => [s, TEXT_SIZE_LABELS[s]]), current.textSize, (textSize) =>
    update({ textSize }),
  );
  const sample = el('p', 'settings-sample', 'You feel something in the air… The Village idiot drools on you.');
  body.append(section('Text size', textSize, sample));

  const volumes: [VolumeLevel, string][] = [
    ['off', 'Off'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ];
  body.append(
    section(
      'Music',
      segmented<VolumeLevel>('Music', volumes, current.music, (music) => update({ music })),
      el('p', 'muted', 'Each place has its own theme, and the music follows your story.'),
    ),
    section(
      'Sound effects',
      segmented<VolumeLevel>('Sound effects', volumes, current.sound, (sound) => update({ sound })),
      el('p', 'muted', 'Combat, doors, magic and the sounds of the world around you.'),
    ),
  );
  body.append(
    section(
      'Animation',
      segmented<AnimationLevel>('Animation', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']], current.animation, (animation) =>
        update({ animation }),
      ),
    ),
  );
  body.append(
    section(
      'Messages',
      segmented<MessageFlow>('Messages', [['flow', 'Flow past'], ['pause', 'Pause at each']], current.messages, (messages) =>
        update({ messages }),
      ),
      el('p', 'muted', 'Messages are always kept in the log: tap them to read back.'),
    ),
  );
  body.append(
    section(
      'Exploring',
      segmented<ExplorePace>('Exploring', [['normal', 'Normal'], ['relaxed', 'Relaxed']], current.explorePace, (explorePace) => update({ explorePace })),
      el('p', 'muted', 'How fast Explore and travel walk. Relaxed takes its time, to watch the way unfold; Speed on the toolbar switches it while exploring.'),
    ),
  );
  body.append(
    section(
      'Dungeon levels',
      segmented<'kept' | 'new'>('Dungeon levels', [['kept', 'Stay as you left them'], ['new', 'New each visit']], current.persistentLevels ? 'kept' : 'new', (value) =>
        update({ persistentLevels: value === 'kept' }),
      ),
      el(
        'p',
        'muted',
        'Levels you leave stay as they were, so you can find your way back through them. Choosing new levels forgets the ones kept so far. Towns and lands you have walked are always remembered.',
      ),
    ),
  );
  body.append(
    section(
      'Map symbols',
      segmented<GlyphMode>('Map symbols', [['brogue', 'Shaded'], ['classic', 'Classic ASCII']], current.glyphs, (glyphs) =>
        update({ glyphs }),
      ),
    ),
  );

  const zoom = el('input', 'zoom-slider');
  zoom.type = 'range';
  zoom.min = String(MIN_ZOOM);
  zoom.max = String(MAX_ZOOM);
  zoom.step = '1';
  zoom.value = String(current.zoom);
  zoom.setAttribute('aria-label', 'Map zoom');
  zoom.addEventListener('input', () => update({ zoom: Number(zoom.value) }));
  body.append(section('Map zoom', zoom, el('p', 'muted', 'You can also pinch the map to zoom.')));

  if (rules) {
    const fixed = section(
      'Your adventure',
      el('p', 'muted', `Chosen when ${rules.hero} was created, these rules hold for the whole adventure.`),
      ...runElements(rules.run, rules.run.drawn),
    );
    fixed.classList.add('adventure-rules');
    body.append(fixed);
  }

  sheets.open({ title: 'Settings', body, className: 'sheet-settings', initial: body.querySelector<HTMLElement>('.segment.selected') });
}

/** The message log, newest at the bottom. */
export function openHistory(sheets: Sheets, messages: readonly MessageState[], palette: readonly string[]): void {
  const list = el('ol', 'history');
  for (const m of [...messages].reverse()) {
    if (!/[^\s=\-_~*]/.test(m.text)) continue;
    const item = el('li', isNotice(m) ? 'notice' : undefined, m.text);
    if (m.color !== 1 && !isNotice(m)) item.style.color = readableColour(palette[m.color] ?? '');
    list.append(item);
  }
  if (!list.childElementCount) list.append(el('li', 'muted', 'No messages yet.'));
  sheets.open({ title: 'Messages', body: list, className: 'sheet-history' });
  requestAnimationFrame(() => list.lastElementChild?.scrollIntoView({ block: 'end' }));
}

export function openTemplate(sheets: Sheets, title: string, templateId: string): void {
  const template = document.getElementById(templateId) as HTMLTemplateElement | null;
  if (!template) return;
  const body = el('div', 'prose');
  body.append(template.content.cloneNode(true));
  sheets.open({ title, body, className: 'sheet-prose' });
}

export function openMessage(sheets: Sheets, title: string, message: string): void {
  const body = el('div', 'prose');
  body.append(el('p', undefined, message));
  sheets.open({ title, body, kind: 'card', actions: [{ label: 'OK', primary: true, run: () => sheets.back() }] });
}

/**
 * A line of text in a compact card at the top of the screen, so the
 * on-screen keyboard never covers it. `label` is the question; an
 * `error` from a previous answer replaces it.
 */
export function askText(
  sheets: Sheets,
  title: string,
  label: string,
  initial = '',
  maxLength = 60,
  error = '',
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const form = el('form', 'ask-text');
    const input = el('input');
    input.type = 'text';
    input.value = initial;
    input.maxLength = maxLength;
    input.placeholder = label;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    input.setAttribute('autocapitalize', 'words');
    input.enterKeyHint = 'done';
    const ok = el('button', 'sheet-action primary', 'OK');
    ok.type = 'submit';
    form.append(input, ok);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      input.blur();
      finish(input.value.trim());
      sheets.back();
    });
    sheets.open({
      title,
      subtitle: error || (initial ? label : undefined),
      body: form,
      kind: 'card',
      className: error ? 'sheet-ask has-error' : 'sheet-ask',
      onClose: () => finish(null),
    });
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
  });
}

export interface QuantityQuestion {
  title: string;
  /** What the number counts, shown above the stepper. */
  label: string;
  max: number;
  /** Starts here; one by default. */
  initial?: number;
  /** Verb for the confirming button ("Drop" → "Drop 3"). */
  verb: string;
  danger?: boolean;
}

/** Asks how many of a stack to use: a stepper starting at one, then the confirming button. */
export function askQuantity(sheets: Sheets, question: QuantityQuestion): Promise<number | null> {
  return new Promise((resolve) => {
    const max = Math.max(1, question.max);
    let value = Math.max(1, Math.min(max, question.initial ?? 1));
    let settled = false;
    const finish = (n: number | null) => {
      if (settled) return;
      settled = true;
      resolve(n);
    };
    const body = el('div', 'ask-quantity');
    body.append(el('p', 'muted', question.label));
    const shown = el('span', 'stepper-value', String(value));
    shown.setAttribute('aria-live', 'polite');
    const button = (label: string, run: () => void, className = 'stepper-button') => {
      const b = el('button', className, label);
      b.type = 'button';
      b.addEventListener('click', run);
      return b;
    };
    const set = (n: number) => {
      value = Math.max(1, Math.min(max, n));
      shown.textContent = String(value);
      const label = body.closest('.sheet')?.querySelector('[data-action="confirm"] .pop-label');
      if (label) label.textContent = `${question.verb} ${value}`;
    };
    const stepper = el('div', 'stepper');
    stepper.append(
      button('−', () => set(value - 1)),
      shown,
      button('+', () => set(value + 1)),
      button('1', () => set(1), 'stepper-button wide'),
      button(`All ${max}`, () => set(max), 'stepper-button wide'),
    );
    body.append(stepper);
    sheets.open({
      title: question.title,
      body,
      kind: 'card',
      className: 'sheet-quantity',
      actions: [
        { id: 'cancel', label: 'Cancel', run: () => sheets.back() },
        {
          id: 'confirm',
          label: `${question.verb} ${value}`,
          primary: !question.danger,
          danger: question.danger,
          run: () => {
            finish(value);
            sheets.back();
          },
        },
      ],
      onKey: (e) => {
        const step = e.key === 'ArrowLeft' || e.key === '-' ? -1 : e.key === 'ArrowRight' || e.key === '+' ? 1 : 0;
        if (!step) return false;
        set(value + step);
        return true;
      },
      onClose: () => finish(null),
    });
  });
}

/** Yes/no question in a sheet. */
export function confirmSheet(sheets: Sheets, title: string, message: string, yes: string, run: () => void, danger = false): void {
  const body = el('div', 'prose');
  body.append(el('p', undefined, message));
  sheets.open({
    title,
    body,
    kind: 'card',
    actions: [
      { label: 'Cancel', run: () => sheets.back() },
      { label: yes, primary: !danger, danger, run },
    ],
  });
}
