import type { Readable } from "node:stream";
import type { BackupStore } from "./store";

/**
 * The tests' `BackupStore`: reads each body to the end, as S3 would, and keeps it in memory. With
 * `failWith`, it reads the body and then refuses it, the way a refused PUT arrives after the upload.
 */
export function fakeBackupStore({ failWith }: { failWith?: Error } = {}) {
  const objects = new Map<string, Buffer>();
  const store: BackupStore = {
    async put(key, body: Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
      if (failWith) throw failWith;
      objects.set(key, Buffer.concat(chunks));
    },
  };
  return { store, objects };
}
