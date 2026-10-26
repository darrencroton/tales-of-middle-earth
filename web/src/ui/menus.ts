import { readableColour } from '../render/colour.ts';
import type { MessageState } from '../render/snapshot.ts';
import {
  TEXT_SIZE_LABELS,
  TEXT_SIZE_PX,
  type AnimationLevel,
  type Settings,
  type TextSize,
} from '../settings.ts';
import type { GlyphMode } from '../render/appearance.ts';
import { MAX_ZOOM, MIN_ZOOM } from '../render/map.ts';
import { el, navButton, section } from './dom.ts';
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
  sheets.open({ title, subtitle, body: list, className: 'sheet-menu' });
}

function segmented<T extends string>(
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

/** Display settings, applied as they change. */
export function openSettings(sheets: Sheets, settings: Settings, apply: (next: Settings) => void): void {
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

  sheets.open({ title: 'Settings', body, className: 'sheet-settings', initial: body.querySelector<HTMLElement>('.segment.selected') });
}

/** The message log, newest at the bottom. */
export function openHistory(sheets: Sheets, messages: readonly MessageState[], palette: readonly string[]): void {
  const list = el('ol', 'history');
  for (const m of [...messages].reverse()) {
    if (!/[^\s=\-_~*]/.test(m.text)) continue;
    const item = el('li', undefined, m.text);
    if (m.color !== 1) item.style.color = readableColour(palette[m.color] ?? '');
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
  sheets.open({ title, body, actions: [{ label: 'OK', primary: true, run: () => sheets.back() }] });
}

/** Asks for one line of text; resolves null if cancelled. */
export function askText(sheets: Sheets, title: string, label: string, initial = '', maxLength = 60): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const form = el('form', 'ask-text');
    const caption = el('label', undefined, label);
    const input = el('input');
    input.type = 'text';
    input.value = initial;
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'words');
    input.enterKeyHint = 'done';
    caption.append(input);
    form.append(caption);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(input.value.trim());
      sheets.back();
    });
    sheets.open({
      title,
      body: form,
      actions: [
        { label: 'Cancel', run: () => sheets.back() },
        { label: 'OK', primary: true, run: () => form.requestSubmit() },
      ],
      onClose: () => finish(null),
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
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
    actions: [
      { label: 'Cancel', run: () => sheets.back() },
      { label: yes, primary: !danger, danger, run },
    ],
  });
}
