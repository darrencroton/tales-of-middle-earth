export const SAVE_FORMAT = 'tome2mobile-saves';
export const SAVE_FORMAT_VERSION = 1;
export const SAVE_FILE_EXTENSION = '.tome2save';

export interface EmscriptenFS {
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  mkdirTree(path: string): void;
  syncfs(populate: boolean, callback: (err: unknown) => void): void;
}

export interface SaveFile {
  path: string;
  data: Uint8Array;
}

export interface SaveBundle {
  format: typeof SAVE_FORMAT;
  version: number;
  exported: string;
  files: { path: string; data: string }[];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Accepts only relative paths made of ordinary segments, so an imported bundle
 * cannot write outside the storage directory.
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function encodeBundle(files: SaveFile[], now: Date = new Date()): string {
  const bundle: SaveBundle = {
    format: SAVE_FORMAT,
    version: SAVE_FORMAT_VERSION,
    exported: now.toISOString(),
    files: files.map((f) => ({ path: f.path, data: bytesToBase64(f.data) })),
  };
  return JSON.stringify(bundle);
}

export function decodeBundle(text: string): SaveFile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not a ToME save file (invalid JSON).');
  }

  const bundle = parsed as Partial<SaveBundle> | null;
  if (!bundle || bundle.format !== SAVE_FORMAT) {
    throw new Error('Not a ToME save file.');
  }
  if (typeof bundle.version !== 'number' || bundle.version > SAVE_FORMAT_VERSION) {
    throw new Error('This save file was made by a newer version of the game.');
  }
  if (!Array.isArray(bundle.files)) {
    throw new Error('Save file is missing its file list.');
  }

  return bundle.files.map((entry) => {
    if (!entry || typeof entry.path !== 'string' || typeof entry.data !== 'string') {
      throw new Error('Save file contains a malformed entry.');
    }
    if (!isSafeRelativePath(entry.path)) {
      throw new Error(`Save file contains an unsafe path: ${entry.path}`);
    }
    try {
      return { path: entry.path, data: base64ToBytes(entry.data) };
    } catch {
      throw new Error(`Save file entry is corrupt: ${entry.path}`);
    }
  });
}

export function collectFiles(fs: EmscriptenFS, root: string): SaveFile[] {
  const files: SaveFile[] = [];
  const walk = (relative: string) => {
    const absolute = relative ? `${root}/${relative}` : root;
    for (const name of fs.readdir(absolute)) {
      if (name === '.' || name === '..') continue;
      const childRelative = relative ? `${relative}/${name}` : name;
      const childAbsolute = `${root}/${childRelative}`;
      if (fs.isDir(fs.stat(childAbsolute).mode)) {
        walk(childRelative);
      } else {
        files.push({ path: childRelative, data: fs.readFile(childAbsolute) });
      }
    }
  };
  walk('');
  return files;
}

/**
 * The reason a bundle cannot be written as a whole: a path listed twice, a
 * path that is also a directory of another entry, or a clash with a file or
 * directory already in storage. Null when every file can be written.
 */
export function bundleConflict(fs: Pick<EmscriptenFS, 'stat' | 'isDir'>, root: string, files: readonly SaveFile[]): string | null {
  const paths = new Set<string>();
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) return `Unsafe path: ${file.path}`;
    if (paths.has(file.path)) return `Listed twice: ${file.path}`;
    paths.add(file.path);
  }
  const isDir = (path: string): boolean | null => {
    try {
      return fs.isDir(fs.stat(path).mode);
    } catch {
      return null;
    }
  };
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (paths.has(dir)) return `${dir} is both a file and a directory`;
      if (isDir(`${root}/${dir}`) === false) return `${dir} already exists as a file`;
    }
    if (isDir(`${root}/${path}`) === true) return `${path} already exists as a directory`;
  }
  return null;
}

/** Writes a bundle into storage; call bundleConflict first so nothing is half written. */
export function writeFiles(fs: EmscriptenFS, root: string, files: SaveFile[]): void {
  const conflict = bundleConflict(fs, root, files);
  if (conflict) throw new Error(conflict);
  for (const file of files) {
    const absolute = `${root}/${file.path}`;
    const dir = absolute.slice(0, absolute.lastIndexOf('/'));
    fs.mkdirTree(dir);
    fs.writeFile(absolute, file.data);
  }
}

export function syncToStorage(fs: EmscriptenFS): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.syncfs(false, (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve()));
  });
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `tome2-saves-${stamp}${SAVE_FILE_EXTENSION}`;
}
