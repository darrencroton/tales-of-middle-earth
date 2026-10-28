// Renders the app icons (web/public/icons) from the title screen's flames and a lit "@".
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { FlameField } from '../web/src/render/fire.ts';

const out = resolve(import.meta.dirname, '../web/public/icons');
const FIELD = 96;
const flames = new FlameField({ reach: 0.72, rise: 8, intensity: 1.15 });
flames.resize(FIELD, FIELD);
flames.update(5.2, 1);

const sizes = { 'icon-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180, 'favicon-64.png': 64 };

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<canvas></canvas>');
  const images = await page.evaluate(
    ({ heat, field, sizes }) => {
      const S = 1024;
      const canvas = document.querySelector('canvas');
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, S, S);

      const glowAt = (x, y, r, stops) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        for (const [at, colour] of stops) g.addColorStop(at, colour);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
      };
      glowAt(S / 2, S * 0.62, S * 0.62, [
        [0, 'rgba(120,40,8,0.9)'],
        [0.6, 'rgba(40,10,2,0.6)'],
        [1, 'rgba(0,0,0,0)'],
      ]);

      const small = document.createElement('canvas');
      small.width = field;
      small.height = field;
      const sctx = small.getContext('2d');
      const image = sctx.createImageData(field, field);
      for (let i = 0; i < heat.length; i++) {
        const k = Math.min(1, heat[i]);
        const o = i * 4;
        image.data[o] = Math.min(255, 255 * k * 1.6);
        image.data[o + 1] = Math.min(255, 255 * Math.max(0, k - 0.35) * 1.4);
        image.data[o + 2] = Math.min(255, 255 * Math.max(0, k - 0.75) * 1.6);
        image.data[o + 3] = Math.min(255, 255 * k * 0.9);
      }
      sctx.putImageData(image, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.filter = 'blur(4px)';
      ctx.drawImage(small, 0, 0, S, S);
      ctx.restore();

      let seed = 11;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let n = 0; n < 34; n++) {
        const x = random() * S;
        const y = S * (0.35 + random() * 0.6);
        const r = 4 + random() * 9;
        glowAt(x, y, r * 2.4, [
          [0, `rgba(255,${190 + random() * 50},110,${0.5 + random() * 0.4})`],
          [1, 'rgba(255,60,0,0)'],
        ]);
      }
      ctx.restore();

      const vignette = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, S, S);

      ctx.font = 'bold 600px "DejaVu Sans Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText('@');
      const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const baseline = S / 2 + height / 2 - m.actualBoundingBoxDescent;
      ctx.save();
      ctx.shadowColor = 'rgba(255,120,30,0.95)';
      ctx.shadowBlur = 70;
      ctx.fillStyle = '#ffb347';
      ctx.fillText('@', S / 2, baseline);
      ctx.restore();
      const lit = ctx.createLinearGradient(0, baseline - m.actualBoundingBoxAscent, 0, baseline + m.actualBoundingBoxDescent);
      lit.addColorStop(0, '#fff1c4');
      lit.addColorStop(0.45, '#f6d48a');
      lit.addColorStop(1, '#e07a1c');
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(40,12,0,0.85)';
      ctx.strokeText('@', S / 2, baseline);
      ctx.fillStyle = lit;
      ctx.fillText('@', S / 2, baseline);

      const result = {};
      for (const [name, size] of Object.entries(sizes)) {
        const target = document.createElement('canvas');
        target.width = size;
        target.height = size;
        const tctx = target.getContext('2d');
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(canvas, 0, 0, size, size);
        result[name] = target.toDataURL('image/png').split(',')[1];
      }
      return result;
    },
    { heat: Array.from(flames.heat), field: FIELD, sizes },
  );
  for (const [name, data] of Object.entries(images)) {
    writeFileSync(resolve(out, name), Buffer.from(data, 'base64'));
    console.log(`wrote ${name}`);
  }
} finally {
  await browser.close();
}
