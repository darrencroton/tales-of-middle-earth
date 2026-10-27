import type { GameAudio } from '../audio/audio.ts';
import { THEME_LIST, type ThemeGroup } from '../audio/themes.ts';
import { el, iconText } from './dom.ts';
import type { Sheets } from './sheet.ts';

const GROUPS: ThemeGroup[] = ['Opening', 'Towns', 'Wilderness', 'Dungeons', 'Quests'];

/** The mood line without the place name before its colon. */
function moodLine(mood: string): string {
  const colon = mood.indexOf(': ');
  const text = colon >= 0 && colon < 40 ? mood.slice(colon + 2) : mood;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every theme of the soundtrack, grouped by where it plays. Tapping a theme
 * plays it; Play all goes through them in turn. Closing the sheet returns
 * to the music for the current place.
 */
export function openSoundtrack(sheets: Sheets, audio: GameAudio): void {
  const body = el('div', 'soundtrack');
  let allMode = false;
  const rows = new Map<string, HTMLButtonElement>();
  const nowPlaying = el('p', 'soundtrack-now', '');
  nowPlaying.setAttribute('aria-live', 'polite');

  for (const group of GROUPS) {
    const themes = THEME_LIST.filter((t) => t.group === group);
    if (!themes.length) continue;
    const list = el('div', 'soundtrack-list');
    for (const theme of themes) {
      const row = el('button', 'row-button soundtrack-row');
      row.type = 'button';
      row.dataset.nav = '';
      row.append(el('span', 'row-icon', iconText('♪')));
      const text = el('span', 'soundtrack-text');
      text.append(el('span', 'row-label', theme.name), el('span', 'soundtrack-mood', moodLine(theme.mood)));
      row.append(text);
      row.addEventListener('click', () => {
        const stop = audio.listeningTo === theme.id && !allMode;
        allMode = false;
        audio.listen(stop ? null : theme.id);
      });
      rows.set(theme.id, row);
      list.append(row);
    }
    const section = el('section', 'sheet-section');
    section.append(el('h3', undefined, group), list);
    body.append(section);
  }

  const show = (id: string | null) => {
    for (const [themeId, row] of rows) {
      const playing = themeId === id;
      row.classList.toggle('playing', playing);
      row.setAttribute('aria-pressed', String(playing));
      const icon = row.querySelector('.row-icon');
      if (icon) icon.textContent = iconText(playing ? '■' : '♪');
    }
    const theme = id ? THEME_LIST.find((t) => t.id === id) : null;
    nowPlaying.textContent = theme ? `${allMode ? 'Playing all · ' : 'Now playing · '}${theme.name}` : 'Tap a theme to listen.';
    if (id && allMode) rows.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  audio.onListen = (id) => {
    if (id === null) allMode = false;
    show(id);
  };
  show(audio.listeningTo);
  body.prepend(nowPlaying);

  sheets.open({
    title: 'Soundtrack',
    subtitle: 'Music composed live for each place',
    body,
    className: 'sheet-soundtrack',
    actions: [
      { label: 'Stop', run: () => audio.listen(null) },
      {
        label: 'Play all',
        primary: true,
        run: () => {
          allMode = true;
          audio.listen('all');
        },
      },
    ],
    onClose: () => {
      audio.onListen = null;
      audio.listen(null);
    },
  });
}
