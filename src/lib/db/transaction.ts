import "server-only";
import { db } from "./index";

/**
 * The few Firestore transaction operations our services use, typed once.
 * Firestore's own transaction type is generic and awkward to share with the in-memory
 * test double, so services use this narrow shape through `runTx` instead of casting at every call site.
 */
export interface Tx {
  get(ref: unknown): Promise<{ exists: boolean; data(): unknown }>;
  set(ref: unknown, data: unknown): void;
  update(ref: unknown, data: unknown): void;
}

/** Runs `fn` in a Firestore transaction (read-modify-write with automatic retry on contention). */
export function runTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().runTransaction((tx) => fn(tx as unknown as Tx));
}
