/**
 * 이미지 Blob 저장소 (명세서 §3.1, 결함 8).
 * 이미지는 맵 문서에 넣지 않고 내용 해시(SHA-256)를 키로 따로 저장한다.
 * 같은 이미지는 한 번만 저장되고, 공유 시에는 상대에게 없는 해시만 전송하면 된다.
 */
import { openDb, promisify, txDone } from './idb';

export interface StoredImage {
  id: string;
  blob: Blob;
  w: number;
  h: number;
}

const STORE = 'images';
let dbPromise: Promise<IDBDatabase> | null = null;

function db() {
  dbPromise ??= openDb('mapops-images', 1, (d) => d.createObjectStore(STORE, { keyPath: 'id' }));
  return dbPromise;
}

export async function hashBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function measureImage(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return size;
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  const tx = (await db()).transaction(STORE, 'readonly');
  return promisify(tx.objectStore(STORE).get(id) as IDBRequest<StoredImage | undefined>);
}

/** 이미지를 저장하고 해시 ID와 크기를 돌려준다. 이미 있으면 다시 쓰지 않는다. */
export async function putImage(blob: Blob): Promise<StoredImage> {
  const id = await hashBytes(await blob.arrayBuffer());
  const existing = await getImage(id);
  if (existing) return existing;
  const { w, h } = await measureImage(blob);
  const rec: StoredImage = { id, blob, w, h };
  const tx = (await db()).transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(rec);
  await txDone(tx);
  return rec;
}

export async function listImageIds(): Promise<string[]> {
  const tx = (await db()).transaction(STORE, 'readonly');
  return (await promisify(tx.objectStore(STORE).getAllKeys())) as string[];
}

export async function deleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = (await db()).transaction(STORE, 'readwrite');
  for (const id of ids) tx.objectStore(STORE).delete(id);
  await txDone(tx);
  for (const id of ids) {
    const url = urlCache.get(id);
    urlCache.delete(id);
    url?.then((u) => u && URL.revokeObjectURL(u));
  }
}

const urlCache = new Map<string, Promise<string | null>>();

/** 화면 표시용 object URL(캐시됨). 이미지가 없으면 null. */
export function imageUrl(id: string): Promise<string | null> {
  let p = urlCache.get(id);
  if (!p) {
    p = getImage(id).then((rec) => (rec ? URL.createObjectURL(rec.blob) : null));
    urlCache.set(id, p);
  }
  return p;
}
