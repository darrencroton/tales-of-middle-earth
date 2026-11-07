/** Content hash of the engine build (see vite.config.ts). */
declare const __ENGINE_VERSION__: string;

interface ImportMetaEnv {
  /** The cloud sync service's root (server/), when the app is built with one. */
  readonly VITE_CLOUD_URL?: string;
}
