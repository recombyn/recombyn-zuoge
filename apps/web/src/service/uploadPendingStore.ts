const DB_NAME = 'rcb-upload-pending';
const DB_VERSION = 1;
const STORE = 'pending';

type PendingUploadRecord = {
  jobId: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'jobId' });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb request failed'));
  });
}

export async function savePendingUploadFile(jobId: string, file: File): Promise<void> {
  const id = String(jobId || '').trim();
  if (!id) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const record: PendingUploadRecord = {
      jobId: id,
      blob: file,
      name: file.name || 'upload.bin',
      type: file.type || 'application/octet-stream',
      size: file.size,
      savedAt: Date.now(),
    };
    tx.objectStore(STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb write failed'));
      tx.onabort = () => reject(tx.error || new Error('idb write aborted'));
    });
  } finally {
    db.close();
  }
}

export async function loadPendingUploadFile(jobId: string): Promise<File | null> {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const raw = await idbReq<PendingUploadRecord | undefined>(tx.objectStore(STORE).get(id));
    if (!raw?.blob) return null;
    return new File([raw.blob], raw.name || 'upload.bin', {
      type: raw.type || 'application/octet-stream',
      lastModified: raw.savedAt || Date.now(),
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function deletePendingUploadFile(jobId: string): Promise<void> {
  const id = String(jobId || '').trim();
  if (!id) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb delete failed'));
      tx.onabort = () => reject(tx.error || new Error('idb delete aborted'));
    });
  } catch {
    /* best-effort */
  } finally {
    db.close();
  }
}
