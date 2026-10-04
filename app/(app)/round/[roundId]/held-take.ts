import type { Take, TakeContentType } from "./recorder";

// A take that has not reached S3 yet, held in IndexedDB (03 §5): the upload goes browser → S3, so a
// failed PUT leaves the only copy of the answer in the browser, and a reload must not be what loses
// it. Written when the take exists, removed once the PUT succeeds.
//
// **One take per round**, keyed by the round: a round asks one prompt at a time. A take held for an
// older round is left alone — only that round's own page may judge it — until it is two days old: a
// round resumes only on the Asia/Tokyo day it started (04 `rounds`), so by then nothing could take it.
//
// Every function resolves rather than throws: where IndexedDB is unavailable the take is simply not
// held, and the screen says it is only in the tab.

const DATABASE = "suburi-round";
const STORE = "held-takes";

/** Which prompt a held take answers: the round, the position, and whether it is that position's follow-up. */
export interface TakeSlot {
  readonly roundId: string;
  readonly position: number;
  readonly followUp: boolean;
}

interface HeldTake extends TakeSlot {
  readonly blob: Blob;
  readonly contentType: TakeContentType;
  readonly heldAt: number;
}

const UNDELIVERABLE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "roundId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const database = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/** Holds the take for its prompt, in place of any earlier take of the same round. `false` when it could not be stored: it is then only in the tab. */
export async function holdTake(slot: TakeSlot, take: Take): Promise<boolean> {
  try {
    const held: HeldTake = { ...slot, blob: take.blob, contentType: take.contentType, heldAt: Date.now() };
    await transact("readwrite", (store) => {
      const all = store.getAll() as IDBRequest<HeldTake[]>;
      all.onsuccess = () => {
        for (const other of all.result) if (held.heldAt - other.heldAt > UNDELIVERABLE_AFTER_MS) store.delete(other.roundId);
        store.put(held);
      };
    });
    return true;
  } catch {
    return false;
  }
}

/** The take held for exactly this prompt, or null. One held for another prompt of this round was answered some other way, and is dropped. */
export async function heldTake(slot: TakeSlot): Promise<Take | null> {
  try {
    const held = await transact<HeldTake | undefined>("readonly", (store) => store.get(slot.roundId));
    if (!held) return null;
    if (held.position === slot.position && held.followUp === slot.followUp) return { blob: held.blob, contentType: held.contentType };
    await releaseTake(slot.roundId);
    return null;
  } catch {
    return null;
  }
}

/** The round's take reached S3, or its prompt is gone: nothing is held for the round any more. */
export async function releaseTake(roundId: string): Promise<void> {
  try {
    await transact("readwrite", (store) => {
      store.delete(roundId);
    });
  } catch {
    // Nothing was held, or nothing can be: either way there is nothing to release.
  }
}
