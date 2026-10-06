/**
 * 맵 저장소. 맵마다 Y.Doc 하나를 IndexedDB(y-indexeddb)에 영속화한다.
 * 맵 목록은 로컬 전용 인덱스 문서에 둔다(공유되는 것은 개별 맵 문서뿐).
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { GameMap, Id } from '../model';
import { readMap, writeMap } from './mapDoc';
import { deleteImages, listImageIds } from './imageStore';

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

const docName = (id: Id) => `mapops-map:${id}`;

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

  /** 처음 한 번 인덱스와 모든 맵 문서를 불러온다. */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      const p = new IndexeddbPersistence('mapops-index', this.indexDoc);
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

  /** 어떤 맵도 참조하지 않는 이미지를 지운다(맵 삭제, 마법사 취소 후). */
  async collectGarbageImages() {
    const used = new Set<string>();
    for (const m of this.cache.values()) for (const f of m.floors) used.add(f.imageId);
    const all = await listImageIds();
    await deleteImages(all.filter((id) => !used.has(id)));
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
