import type { Take, TakeContentType } from "./recorder";

// A take that has not reached S3 yet, held in IndexedDB (03 §5): the upload goes browser → S3, so a
// failed PUT leaves the only copy of the answer in the browser, and a reload must not be what loses
// it. Written when the take exists, removed once the server confirms it read the uploaded object.
//
// **One take per prompt**, keyed by the round, the position and whether it is the follow-up. A take
// the route refused can never reach S3: it stays, marked with the refusal, until its round ends. A
// take held for an older round is left alone — only that round's own page may judge it.
//
// A take also keeps what the page cannot read back from the server while no answer row exists: the
// prompt's text and follow-up version, and — for practice's "answer again" — the answer it is given
// beside. A reload before the slot opened has no other record of which answer was being given again.
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

/** The slot route's refusals no retry can get past (07 §5.6). */
export type UploadRejection = "upload_too_large" | "unsupported_content_type";

/** What the take answers, beyond its slot: kept with it because no answer row may exist to say so. */
export interface HeldPrompt {
  readonly text: string;
  /** Set for a follow-up: its prompt version. */
  readonly followUpVersion: string | null;
  /** Practice's "answer again" (10 §15): the answer this take is given beside. */
  readonly again: string | null;
}

export interface StoredTake extends Take {
  /** Set when the route refused the take: it is answered by typing, not by a retry. */
  readonly rejection?: UploadRejection;
}

/** A held take, with the prompt it answers — what a reload offers it back as. */
export interface HeldAnswerAgain extends StoredTake, TakeSlot, HeldPrompt {}

interface HeldTake extends TakeSlot, Partial<HeldPrompt> {
  readonly id: string;
  readonly blob: Blob;
  readonly contentType: TakeContentType;
  readonly rejection?: UploadRejection;
}

const keyOf = (slot: TakeSlot) => `${slot.roundId}:${slot.position}:${slot.followUp}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
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

/** Holds the take for its prompt. `false` when it could not be stored: it is then only in the tab. */
export async function holdTake(slot: TakeSlot, take: Take, prompt: HeldPrompt, rejection?: UploadRejection): Promise<boolean> {
  try {
    const held: HeldTake = { ...slot, ...prompt, id: keyOf(slot), blob: take.blob, contentType: take.contentType, rejection };
    await transact("readwrite", (store) => store.put(held));
    return true;
  } catch {
    return false;
  }
}

/** The take held for exactly this prompt, or null. */
export async function heldTake(slot: TakeSlot): Promise<StoredTake | null> {
  try {
    const held = await transact<HeldTake | undefined>("readonly", (store) => store.get(keyOf(slot)));
    return held ? { blob: held.blob, contentType: held.contentType, rejection: held.rejection } : null;
  } catch {
    return null;
  }
}

/**
 * The take held for the round that answers a prompt again and has no answer row yet, or null. A reload
 * cannot find it by the prompt it opens on: the server has nothing to say it was given.
 */
export async function heldAnswerAgain(roundId: string): Promise<HeldAnswerAgain | null> {
  try {
    const all = await transact<HeldTake[]>("readonly", (store) => store.getAll(IDBKeyRange.bound(`${roundId}:`, `${roundId}:￿`)));
    const held = (all ?? []).find((take) => take.again != null && take.text !== undefined);
    if (!held) return null;
    return {
      roundId: held.roundId,
      position: held.position,
      followUp: held.followUp,
      text: held.text ?? "",
      followUpVersion: held.followUpVersion ?? null,
      again: held.again ?? null,
      blob: held.blob,
      contentType: held.contentType,
      rejection: held.rejection,
    };
  } catch {
    return null;
  }
}

/** The answer given again now has its row, so a reload opens on it: the take stays held, and no longer names the answer it is beside. */
export async function forgetAnswerAgain(slot: TakeSlot): Promise<void> {
  try {
    await transact("readwrite", (store) => {
      const request = store.get(keyOf(slot));
      request.onsuccess = () => {
        if (request.result) store.put({ ...request.result, again: null });
      };
    });
  } catch {
    // Nothing was held, or nothing can be: either way there is nothing to change.
  }
}

/** The prompt's take reached S3: it is no longer held. */
export async function releaseTake(slot: TakeSlot): Promise<void> {
  try {
    await transact("readwrite", (store) => {
      store.delete(keyOf(slot));
    });
  } catch {
    // Nothing was held, or nothing can be: either way there is nothing to release.
  }
}

/** The round has ended: nothing is held for it any more. */
export async function releaseRoundTakes(roundId: string): Promise<void> {
  try {
    await transact("readwrite", (store) => {
      store.delete(IDBKeyRange.bound(`${roundId}:`, `${roundId}:￿`));
    });
  } catch {
    // Nothing was held, or nothing can be: either way there is nothing to release.
  }
}
