/** How often an open app asks for a new version, and the least time between two asks when it returns to the foreground. */
const UPDATE_EVERY_MS = 30 * 60_000;
const UPDATE_RECHECK_MS = 60_000;

/**
 * New versions of the app from its service worker. A new version waits until
 * nothing is in progress: it takes over (and the page reloads) only while the
 * title screen idles (`idle`), so a game or a character being created is
 * never lost.
 */
export class Updates {
  private readonly idle: () => boolean;
  /** Set once a service worker is registered: asks a waiting update to take over. */
  private adoptWaiting: (() => void) | null = null;

  /** `idle`: nothing is in progress (the title screen idles). */
  constructor(idle: () => boolean) {
    this.idle = idle;
  }

  /** Registers the service worker once the page has loaded (in a production build). */
  register(): void {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => this.watch(registration))
        .catch((err) => console.warn('Service worker registration failed', err));
    });
  }

  /** Asks a waiting update to take over, if nothing is in progress. */
  adopt(): void {
    this.adoptWaiting?.();
  }

  private watch(registration: ServiceWorkerRegistration): void {
    const adopt = (worker: ServiceWorker | null) => {
      if (worker && worker.state === 'installed' && navigator.serviceWorker.controller && this.idle()) {
        worker.postMessage({ type: 'skip-waiting' });
      }
    };
    this.adoptWaiting = () => adopt(registration.waiting);
    adopt(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => adopt(worker));
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.idle()) location.reload();
    });
    let checkedAt = performance.now();
    const check = () => {
      const now = performance.now();
      if (document.visibilityState !== 'visible' || now - checkedAt < UPDATE_RECHECK_MS) return;
      checkedAt = now;
      registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', check);
    window.setInterval(check, UPDATE_EVERY_MS);
  }
}
