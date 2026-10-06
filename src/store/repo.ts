/**
 * 맵 저장소. 맵마다 Y.Doc 하나를 IndexedDB(y-indexeddb)에 영속화한다.
 * 맵 목록은 로컬 전용 인덱스 문서에 둔다(공유되는 것은 개별 맵 문서뿐).
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { GameMap, Id } from '../model';
import { readMap, writeMap } from './mapDoc';
import { closeImageDb, deleteImages, IMAGE_DB, listImageIds } from './imageStore';

export interface ShareInfo {
  /** 방 암호(링크에 포함). */
  secret: string;
}

interface IndexEntry {
  addedAt: number;
  /** 공유 중이면 방 정보(로컬 전용 — 인덱스 문서는 공유되지 않음). */
  share?: ShareInfo;
}

interface OpenDoc {
  doc: Y.Doc;
  persist: IndexeddbPersistence;
}

const INDEX_DB = 'mapops-index';
const MAP_DB_PREFIX = 'mapops-map:';
const docName = (id: Id) => `${MAP_DB_PREFIX}${id}`;

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // 다른 탭이 열고 있으면 그 탭이 닫힐 때까지 보류된다 — 기다리지 않고 진행(다음 로드 전에 처리됨)
    req.onblocked = () => resolve();
  });
}

export class Repo {
  private indexDoc = new Y.Doc();
  private index = this.indexDoc.getMap<IndexEntry>('maps');
  private docs = new Map<Id, OpenDoc>();
  private cache = new Map<Id, GameMap>();
  private snapshot: GameMap[] = [];
  /** 인덱스에는 있지만 아직 내용이 없는 맵(공유 참여 후 동기화 대기). */
  private pending: Id[] = [];
  private listeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;
  private indexPersist: IndexeddbPersistence | null = null;

  /** 처음 한 번 인덱스와 모든 맵 문서를 불러온다. */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      const p = new IndexeddbPersistence(INDEX_DB, this.indexDoc);
      this.indexPersist = p;
      await p.whenSynced;
      await Promise.all(Array.from(this.index.keys()).map((id) => this.openDoc(id)));
      this.index.observe(() => this.rebuild());
      this.rebuild();
    })();
    return this.initPromise;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** 추가된 순서의 맵 목록. 바뀔 때만 새 배열(useSyncExternalStore용). */
  getSnapshot = () => this.snapshot;

  getMap(id: Id): GameMap | undefined {
    return this.cache.get(id);
  }

  getPendingIds = () => this.pending;

  hasMap(id: Id): boolean {
    return this.index.has(id);
  }

  getShare(id: Id): ShareInfo | undefined {
    return this.index.get(id)?.share;
  }

  /** 공유된 맵 ID 목록(앱 시작 시 자동 재접속용). */
  sharedIds(): Id[] {
    return Array.from(this.index.entries())
      .filter(([, e]) => e.share)
      .map(([id]) => id);
  }

  setShare(id: Id, share: ShareInfo | null) {
    const entry = this.index.get(id);
    if (!entry) return;
    const next: IndexEntry = { addedAt: entry.addedAt };
    if (share) next.share = share;
    this.index.set(id, next);
  }

  /** 공유 링크로 참여: 빈 문서를 열어 두고 상대에게서 내용을 받는다. 이미 있으면 그대로. */
  async joinMap(id: Id, share: ShareInfo): Promise<Y.Doc> {
    const { doc } = await this.openDoc(id);
    const entry = this.index.get(id);
    this.index.set(id, { addedAt: entry?.addedAt ?? Date.now(), share });
    return doc;
  }

  /** 맵 문서(Y.Doc). 실시간 공유(M6)에서 공급자를 붙이는 지점. */
  getDoc(id: Id): Y.Doc | undefined {
    return this.docs.get(id)?.doc;
  }

  async createMap(map: GameMap): Promise<void> {
    if (this.index.has(map.id)) throw new Error(`이미 있는 맵 ID: ${map.id}`);
    const { doc } = await this.openDoc(map.id);
    writeMap(doc, map);
    this.index.set(map.id, { addedAt: Date.now() });
  }

  saveMap(map: GameMap): void {
    const open = this.docs.get(map.id);
    if (!open) throw new Error(`열리지 않은 맵: ${map.id}`);
    writeMap(open.doc, { ...map, updatedAt: Date.now() });
  }

  async deleteMap(id: Id): Promise<void> {
    const open = this.docs.get(id);
    this.index.delete(id);
    this.docs.delete(id);
    this.cache.delete(id);
    if (open) {
      await open.persist.clearData();
      open.doc.destroy();
    }
    this.rebuild();
    await this.collectGarbageImages();
  }

  /** 어떤 맵도 참조하지 않는 이미지를 지운다(맵 삭제, 마법사 취소 후). 지운 개수를 돌려준다. */
  async collectGarbageImages(): Promise<number> {
    const used = new Set<string>();
    for (const m of this.cache.values()) for (const f of m.floors) used.add(f.imageId);
    const all = await listImageIds();
    const unused = all.filter((id) => !used.has(id));
    await deleteImages(unused);
    return unused.length;
  }

  /** 맵 문서(마커·낙서·정렬 등)의 대략적 크기(바이트). 이미지는 제외. */
  docBytes(id: Id): number {
    const open = this.docs.get(id);
    return open ? Y.encodeStateAsUpdate(open.doc).byteLength : 0;
  }

  /**
   * 이 브라우저의 MAP OPS 데이터를 모두 지운다(맵·이미지·목록).
   * 연결을 닫은 뒤 데이터베이스를 삭제하므로, 호출 후에는 페이지를 새로 불러와야 한다.
   */
  async wipeAll(): Promise<void> {
    const names = new Set<string>([INDEX_DB, IMAGE_DB, ...Array.from(this.docs.keys()).map(docName)]);
    for (const { doc, persist } of this.docs.values()) {
      await persist.destroy();
      doc.destroy();
    }
    this.docs.clear();
    this.cache.clear();
    await this.indexPersist?.destroy();
    await closeImageDb();
    // 열지 못한(손상·이전 버전) 데이터베이스까지 찾아서 지운다
    if (typeof indexedDB.databases === 'function') {
      for (const info of await indexedDB.databases()) {
        if (info.name && (info.name === INDEX_DB || info.name === IMAGE_DB || info.name.startsWith(MAP_DB_PREFIX))) names.add(info.name);
      }
    }
    await Promise.all(Array.from(names).map(deleteDatabase));
  }

  private async openDoc(id: Id): Promise<OpenDoc> {
    const existing = this.docs.get(id);
    if (existing) return existing;
    const doc = new Y.Doc();
    const persist = new IndexeddbPersistence(docName(id), doc);
    const open = { doc, persist };
    this.docs.set(id, open);
    await persist.whenSynced;
    doc.on('update', () => this.refresh(id));
    this.refresh(id, false);
    return open;
  }

  private refresh(id: Id, notify = true) {
    const open = this.docs.get(id);
    const map = open && readMap(open.doc, id);
    if (map) this.cache.set(id, map);
    else this.cache.delete(id);
    if (notify) this.rebuild();
  }

  private rebuild() {
    const entries = Array.from(this.index.entries()).sort((a, b) => a[1].addedAt - b[1].addedAt);
    this.snapshot = entries.map(([id]) => this.cache.get(id)).filter((m): m is GameMap => !!m);
    const pending = entries.filter(([id]) => !this.cache.has(id)).map(([id]) => id);
    if (pending.join() !== this.pending.join()) this.pending = pending;
    for (const fn of this.listeners) fn();
  }
}

export const repo = new Repo();
