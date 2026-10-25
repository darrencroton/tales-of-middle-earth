import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const root = resolve(import.meta.dirname, 'web');
const publicDir = resolve(root, 'public');
const engineFiles = ['engine/tome.js', 'engine/tome.wasm', 'engine/tome.data'];

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/**
 * Emits sw.js with a precache list of every built and public file. The cache
 * name is derived from file contents, so each deploy installs a fresh cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'tome2mobile-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const missing = engineFiles.filter((f) => !existsSync(join(publicDir, f)));
      if (missing.length > 0) {
        this.error(`Engine build output missing (${missing.join(', ')}); run npm run engine:build first.`);
      }

      const hash = createHash('sha256');
      const urls = new Set<string>(['./']);

      for (const file of listFiles(publicDir)) {
        const path = relative(publicDir, file).split(sep).join('/');
        if (path === 'sw.js' || path.endsWith('.gitignore')) continue;
        urls.add(`./${path}`);
        hash.update(path).update(readFileSync(file));
      }

      for (const [fileName, output] of Object.entries(bundle)) {
        urls.add(`./${fileName}`);
        hash.update(fileName).update(output.type === 'chunk' ? output.code : output.source);
      }

      const version = hash.digest('hex').slice(0, 16);
      const precache = JSON.stringify([...urls].sort(), null, 2);

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'tome2mobile-${version}';
const PRECACHE = ${precache};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./', { cacheName: CACHE }).then((r) => r || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE }).then((cached) => cached || fetch(request)),
  );
});
`,
      });
    },
  };
}

export default defineConfig({
  root,
  base: './',
  publicDir,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
  plugins: [serviceWorker()],
  server: {
    host: true,
  },
});
