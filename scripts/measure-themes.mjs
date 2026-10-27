// Renders every theme offline in headless Chromium and prints its level (dBFS before the theme gain) for MEASURED_DB in web/src/audio/themes.ts.
// Usage: npm run dev, then node scripts/measure-themes.mjs [seconds] [id,id...]
import { chromium } from '@playwright/test';
const seconds = Number(process.argv[2] ?? 30);
const only = process.argv[3] ? process.argv[3].split(',') : null;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.URL ?? 'http://localhost:5173/');
const result = await page.evaluate(async ({ seconds, only }) => {
  const { AudioCore } = await import('/src/audio/core.ts');
  const { MusicPlayer } = await import('/src/audio/music.ts');
  const { THEME_LIST, themeGain } = await import('/src/audio/themes.ts');
  const out = {};
  for (const theme of THEME_LIST) {
    if (only && !only.includes(theme.id)) continue;
    const sr = 22050;
    const ctx = new OfflineAudioContext(2, sr * seconds, sr);
    const core = new AudioCore(ctx);
    core.musicVolume.gain.value = 0.6 * 0.75;
    let fake = 0;
    Object.defineProperty(core, 'now', { get: () => fake });
    const music = new MusicPlayer(core);
    music.play(theme);
    for (fake = 0; fake < seconds; fake += 0.09) music.tick();
    const buffer = await ctx.startRendering();
    let sum = 0;
    let n = 0;
    let peak = 0;
    for (let c = 0; c < 2; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) { sum += d[i] * d[i]; n++; peak = Math.max(peak, Math.abs(d[i])); }
    }
    const db = 10 * Math.log10(sum / n) - 20 * Math.log10(themeGain(theme.id));
    out[theme.id] = { db: Math.round(db * 10) / 10, peak: Math.round(peak * 100) / 100 };
  }
  return out;
}, { seconds, only });
console.log(JSON.stringify(result));
console.error(errors.slice(0, 10).join('\n'));
await browser.close();
