// Renders sound-effect scenarios offline in headless Chromium and prints, for each sound, its peak level and how far it
// stands out of everything else playing in its moment (the other sounds and, optionally, a music theme at medium volume),
// over its whole length and over its onset.
// Usage: npm run dev, then node scripts/measure-sfx.mjs scenarios.json
// scenarios.json: [{ "name": "...", "music": "theme-id"?, "offset": 4?, "duration": 2.5?, "events": [{ "cue": { "id": "cast", "variant": "arcane" }, "at": 0 }] }]
// With music, events start `offset` seconds in (default 4), once the theme is under way; `duration` is counted from there.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/measure-sfx.mjs scenarios.json');
  process.exit(1);
}
const scenarios = JSON.parse(readFileSync(file, 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.URL ?? 'http://localhost:5173/');
const results = await page.evaluate(async (scenarios) => {
  const { AudioCore } = await import('/src/audio/core.ts');
  const { SoundEffects } = await import('/src/audio/sfx.ts');
  const { MusicPlayer } = await import('/src/audio/music.ts');
  const { themeById } = await import('/src/audio/themes.ts');
  const SR = 44100;
  const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  /* One render: the events given and, when named, the music; every source seeded so passes match sample for sample. */
  async function render(events, music, dur) {
    const random = Math.random;
    try {
      const ctx = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
      const core = new AudioCore(ctx);
      core.musicVolume.gain.value = 0.6 * 0.75;
      core.soundVolume.gain.value = 0.6;
      let fake = 0;
      Object.defineProperty(core, 'now', { get: () => fake });
      const sfx = new SoundEffects(core);
      for (const e of events) {
        Math.random = seeded(e.seed);
        sfx.play(e.cue, e.at);
      }
      if (music) {
        Math.random = seeded(3);
        const player = new MusicPlayer(core);
        player.play(themeById(music));
        for (fake = 0; fake < dur; fake += 0.09) player.tick();
      }
      Math.random = random;
      const buf = await ctx.startRendering();
      const l = buf.getChannelData(0);
      const r = buf.getChannelData(1);
      const mono = new Float32Array(l.length);
      for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2;
      return mono;
    } finally {
      Math.random = random;
    }
  }
  const W = Math.round(SR * 0.02);
  /* The first 160 ms of a sound, where the ear places it. */
  const ONSET_FRAMES = 8;
  const power = (x) => {
    const out = [];
    for (let i = 0; i + W <= x.length; i += W) {
      let s = 0;
      for (let j = i; j < i + W; j++) s += x[j] * x[j];
      out.push(s / W);
    }
    return out;
  };
  const db = (p) => 10 * Math.log10(p + 1e-12);
  const out = [];
  for (const sc of scenarios) {
    const offset = sc.offset ?? (sc.music ? 4 : 0);
    const dur = offset + (sc.duration ?? 2.5);
    const events = sc.events.map((e, i) => ({ ...e, at: e.at + offset, seed: 11 + i * 97 }));
    const full = await render(events, sc.music, dur);
    const rows = [];
    for (const [k, event] of events.entries()) {
      const aloneWave = await render([event], null, dur);
      const alone = power(aloneWave);
      const rest = full.map((v, i) => v - aloneWave[i]);
      const others = power(rest);
      const peak = Math.max(...alone);
      let eCue = 0;
      let eOthers = 0;
      let n = 0;
      let first = -1;
      let onCue = 0;
      let onOthers = 0;
      for (let f = 0; f < alone.length; f++) {
        if (alone[f] < peak * 0.03) continue;
        if (first < 0) first = f;
        eCue += alone[f];
        eOthers += others[f];
        n++;
        if (f - first < ONSET_FRAMES) {
          onCue += alone[f];
          onOthers += others[f];
        }
      }
      const alonePlay = events.length > 1 || sc.music;
      rows.push({
        cue: `${event.cue.id}${event.cue.variant ? `:${event.cue.variant}` : ''}${event.cue.element ? `/${event.cue.element}` : ''}`,
        at: Math.round((event.at - offset) * 1000) / 1000,
        peak: db(peak),
        active: n * 20,
        over: alonePlay ? db(eCue) - db(eOthers) : null,
        onset: alonePlay ? db(onCue) - db(onOthers) : null,
        k,
      });
    }
    out.push({ name: sc.name, rows });
  }
  return out;
}, scenarios);
for (const sc of results) {
  console.log(`\n${sc.name}`);
  for (const r of sc.rows) {
    const over = r.over === null ? '' : `  over the rest ${r.over.toFixed(1).padStart(6)} dB, onset ${r.onset.toFixed(1).padStart(6)} dB`;
    console.log(`  ${r.cue.padEnd(20)} at ${String(r.at).padEnd(5)} peak ${r.peak.toFixed(1).padStart(6)} dB  active ${String(r.active).padStart(4)} ms${over}`);
  }
}
if (errors.length) console.error(errors.join('\n'));
await browser.close();
