export type PendingUpload = {
  id: string;
  createdAt: number;
  endpoint: string;
  method: "POST" | "PUT";
  headers?: Record<string, string>;
  bodyType: "formdata" | "blob";
  body:
    | ArrayBuffer
    | { key: string; fileName: string; type: string; bytes: ArrayBuffer }[];
  meta?: Record<string, any>;
};

const DB_NAME = "magang-app";
const DB_VERSION = 1;
const STORE = "pendingUploads";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbAdd(item: PendingUpload) {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

export async function idbGetAll(): Promise<PendingUpload[]> {
  const db = await openDB();
  const out = await new Promise<PendingUpload[]>((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result as PendingUpload[]);
    req.onerror = () => rej(req.error);
  });
  db.close();
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function idbDelete(id: string) {
  const db = await openDB();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}