import type { Bucket } from '../server/src/worker.ts';

/** An R2 bucket in memory, for running the sync service in tests. */
export class MemoryBucket implements Bucket {
  readonly objects = new Map<string, { data: Uint8Array; etag: string; uploaded: Date }>();
  private serial = 0;
  /** The clock uploads are stamped with. */
  clock = () => Date.now();

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    const data = object.data;
    return {
      etag: object.etag,
      arrayBuffer: async () => data.slice().buffer,
      text: async () => new TextDecoder().decode(data),
    };
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { etag: object.etag, size: object.data.length } : null;
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { onlyIf?: { etagMatches?: string } }) {
    const current = this.objects.get(key);
    if (options?.onlyIf?.etagMatches !== undefined && current?.etag !== options.onlyIf.etagMatches) return null;
    const data = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value.slice() : new Uint8Array(value.slice(0));
    const etag = `e${++this.serial}`;
    this.objects.set(key, { data, etag, uploaded: new Date(this.clock()) });
    return { etag };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list(options: { prefix: string; cursor?: string }) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(options.prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = keys.slice(start, start + 2);
    const truncated = start + 2 < keys.length;
    return {
      objects: page.map((key) => ({ key, size: this.objects.get(key)!.data.length, uploaded: this.objects.get(key)!.uploaded })),
      truncated,
      cursor: truncated ? String(start + 2) : undefined,
    };
  }
}
