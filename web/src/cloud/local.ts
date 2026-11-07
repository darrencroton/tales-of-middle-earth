/**
 * What this browser keeps of cloud sync: the device and its session
 * (localStorage), and the files as they were at the last sync (IndexedDB),
 * which tell what changed on each side since.
 */
import type { FileList } from './plan.ts';
import type { Manifest } from './protocol.ts';

const ACCOUNT_KEY = 'tome2mobile.cloud';
const DB = 'tome2mobile-cloud';
const STORE = 'base';
const RECORD = 'base';

export interface Account {
  /** This device's id in leases; kept when signed out. */
  device: string;
  session?: string;
  /** When the last sync finished (ms, this device's clock). */
  synced?: number;
  /** When syncs began to fail, while they fail. */
  failing?: number;
  /** The suggestion to turn sync on has been shown. */
  suggested?: boolean;
  /** Heroes taken up on another device during a game here: the next full sync takes the cloud's copy. */
  yielded?: string[];
  /** When each hero was last the same here and in the cloud (ms, this device's clock), by savefile name. */
  inStep?: Record<string, number>;
}

function randomDevice(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function loadAccount(): Account {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null') as Partial<Account> | null;
    if (raw && typeof raw.device === 'string' && raw.device) {
      return {
        device: raw.device,
        session: typeof raw.session === 'string' ? raw.session : undefined,
        synced: typeof raw.synced === 'number' ? raw.synced : undefined,
        failing: typeof raw.failing === 'number' ? raw.failing : undefined,
        suggested: raw.suggested === true,
        yielded: Array.isArray(raw.yielded) ? raw.yielded.filter((h): h is string => typeof h === 'string') : undefined,
        inStep: raw.inStep && typeof raw.inStep === 'object' ? Object.fromEntries(Object.entries(raw.inStep).filter(([, t]) => typeof t === 'number')) : undefined,
      };
    }
  } catch {
    /* Unreadable: a new device id. */
  }
  return { device: randomDevice() };
}

export function saveAccount(account: Account): void {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch (err) {
    console.warn('Could not keep the cloud account', err);
  }
}

/** The files at the last sync, the leases then, and the contents of the shared files (to merge from). */
export interface Base {
  files: FileList;
  heroes: Manifest['heroes'];
  contents: Record<string, Uint8Array>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadBase(): Promise<Base> {
  const raw = (await transact('readonly', (store) => store.get(RECORD))) as Partial<Base> | undefined;
  if (!raw || !raw.files || !raw.heroes || !raw.contents) return { files: {}, heroes: {}, contents: {} };
  return { files: raw.files, heroes: raw.heroes, contents: raw.contents };
}

export async function saveBase(base: Base): Promise<void> {
  await transact('readwrite', (store) => store.put(base, RECORD));
}

export async function clearBase(): Promise<void> {
  await transact('readwrite', (store) => store.delete(RECORD));
}
