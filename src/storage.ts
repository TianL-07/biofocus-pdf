import type { Paper } from "./types";
const db = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("biofocus", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("papers", { keyPath: "id" });
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    let value: T;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      database.close();
      resolve(value);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
  });
}
export const listPapers = () =>
  transact<Paper[]>("papers", "readonly", (s) => s.getAll());
export const savePaper = (paper: Paper) =>
  transact("papers", "readwrite", (s) => s.put(paper));
export const saveFile = (id: string, bytes: ArrayBuffer) =>
  transact("files", "readwrite", (s) => s.put(bytes, id));
export const getFile = (id: string) =>
  transact<ArrayBuffer>("files", "readonly", (s) => s.get(id));
export const removePaper = async (id: string) => {
  await transact("papers", "readwrite", (s) => s.delete(id));
  await transact("files", "readwrite", (s) => s.delete(id));
};
export async function fileHash(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
