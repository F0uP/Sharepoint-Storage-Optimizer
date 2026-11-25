import { delMany, getMany, keys, setMany } from "idb-keyval";

/** Key-value storage: IndexedDB in the app, a Map in tests (tests/graph-fakes.ts). */
export interface KeyValueStorage {
  getMany<T>(keys: string[]): Promise<(T | undefined)[]>;
  /** writes all entries in one transaction – all or nothing */
  setMany(entries: [string, unknown][]): Promise<void>;
  delMany(keys: string[]): Promise<void>;
  keys(): Promise<IDBValidKey[]>;
}

export const idbStorage: KeyValueStorage = {
  getMany: (list) => getMany(list),
  setMany: (entries) => setMany(entries),
  delMany: (list) => delMany(list),
  keys: () => keys(),
};

/** Keys starting with `prefix` (string keys only). */
export async function keysWithPrefix(storage: KeyValueStorage, prefix: string): Promise<string[]> {
  return (await storage.keys()).filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
}
