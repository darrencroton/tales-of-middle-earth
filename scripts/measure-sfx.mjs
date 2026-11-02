// Renders sound-effect scenarios offline in headless Chromium and prints, for each sound, its peak level and how far it
// stands out of everything else playing in its moment (the other sounds and, optionally, a music theme at medium volume):
// its loudest 200 ms over the rest's mean while it sounds, K-weighted as ITU-R BS.1770 hears loudness, so a sound that
// rings on is judged by its loudest moment, not its average.
// Usage: npm run dev, then node scripts/measure-sfx.mjs scenarios.json [--phone]
// --phone hears it through a 250 Hz high-pass, as a phone speaker does, which cannot play the lows.
// scenarios.json: [{ "name": "...", "music": "theme-id"?, "offset": 4?, "duration": 2.5?, "events": [{ "cue": { "id": "cast", "variant": "arcane" }, "at": 0 }] }]
// With music, events start `offset` seconds in (default 4), once the theme is under way; `duration` is counted from there.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const file = process.argv[2];
const phone = process.argv.includes('--phone');
if (!file) {
  console.error('Usage: node scripts/measure-sfx.mjs scenarios.json [--phone]');
  process.exit(1);
}
const scenarios = JSON.parse(readFileSync(file, 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.URL ?? 'http://localhost:5173/');
const results = await page.evaluate(async ({ scenarios, phone }) => {
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
      /* BS.1770's K-weighting: a high shelf for the head, then a high-pass for the ear's low end. */
      const head = ctx.createIIRFilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
      const ear = ctx.createIIRFilter([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
      head.connect(ear);
      ear.connect(ctx.destination);
      let input = head;
      if (phone) {
        const speaker = ctx.createBiquadFilter();
        speaker.type = 'highpass';
        speaker.frequency.value = 250;
        speaker.Q.value = 0.7;
        speaker.connect(head);
        input = speaker;
      }
      Object.defineProperty(ctx, 'destination', { value: input });
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
  /* 200 ms, in frames of 20 ms. */
  const MOMENT = 10;
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
    for (const event of events) {
      const aloneWave = await render([event], null, dur);
      const alone = power(aloneWave);
      const rest = full.map((v, i) => v - aloneWave[i]);
      const others = power(rest);
      const peak = Math.max(...alone);
      let eOthers = 0;
      let n = 0;
      for (let f = 0; f < alone.length; f++) {
        if (alone[f] < peak * 0.03) continue;
        eOthers += others[f];
        n++;
      }
      let loudest = 0;
      for (let f = 0; f + MOMENT <= alone.length; f++) {
        let sum = 0;
        for (let k = f; k < f + MOMENT; k++) sum += alone[k];
        loudest = Math.max(loudest, sum / MOMENT);
      }
      const measured = events.length > 1 || sc.music;
      rows.push({
        cue: `${event.cue.id}${event.cue.variant ? `:${event.cue.variant}` : ''}${event.cue.element ? `/${event.cue.element}` : ''}`,
        at: Math.round((event.at - offset) * 1000) / 1000,
        peak: db(peak),
        active: n * 20,
        over: measured ? db(loudest) - db(eOthers / n) : null,
      });
    }
    out.push({ name: sc.name, rows });
  }
  return out;
}, { scenarios, phone });
for (const sc of results) {
  console.log(`\n${sc.name}`);
  for (const r of sc.rows) {
    const over = r.over === null ? '' : `  over the rest ${r.over.toFixed(1).padStart(6)} dB`;
    console.log(`  ${r.cue.padEnd(20)} at ${String(r.at).padEnd(5)} peak ${r.peak.toFixed(1).padStart(6)} dB  active ${String(r.active).padStart(4)} ms${over}`);
  }
}
if (errors.length) console.error(errors.join('\n'));
await browser.close();
