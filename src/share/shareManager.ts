/**
 * 세션 단위 공유 관리: 시작·참여·나가기, 세션에 포함할 맵 관리, 앱 시작 시 재접속, 기기별 설정.
 *
 * 세션 목록 문서(Y.Doc, 'maps': 맵 ID → { addedAt })가 "이 세션에 어떤 맵이 들어 있는지"를 모두에게 공유한다.
 * 목록에 맵이 생기면 각자 그 맵 문서를 붙여 동기화하고(없으면 빈 문서로 받기 시작), 빠지면 떼어 낸다(사본은 남음).
 */
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Vec } from '../geometry';
import { newId, type Id } from '../model';
import { repo, type SessionInfo } from '../store/repo';
import { WorkspaceSession, type PeerUser, type RemoteProbe, type SessionStatus } from './session';

const COLORS = ['#e0a83e', '#4fbf83', '#c678dd', '#e0555a', '#56b6c2', '#ff9f43'];
const WS_DB_PREFIX = 'mapops-ws:';

/* ---------- 기기별 설정(localStorage) ---------- */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 불가 — 이번 세션에만 적용 */
  }
}

export function getUser(): PeerUser {
  const saved = read<PeerUser | null>('mapops.user', null);
  if (saved && typeof saved.name === 'string' && typeof saved.color === 'string') return saved;
  const user = { name: `요원${Math.floor(Math.random() * 900 + 100)}`, color: COLORS[Math.floor(Math.random() * COLORS.length)]! };
  write('mapops.user', user);
  return user;
}

/** 사용자가 지정한 Nostr 릴레이. 비어 있으면 Trystero 기본 릴레이(여러 곳에 중복 연결). */
export function getRelays(): string[] {
  const s = read<string[]>('mapops.relays', []);
  return Array.isArray(s) ? s.filter((u) => typeof u === 'string') : [];
}

/* ---------- 링크 ---------- */

/** 친구가 열 수 있는 공개 주소(GitHub Pages). */
export const PUBLIC_APP_URL = 'https://95gudeh-png.github.io/map-ops/';

/** 이 컴퓨터에서만 열리는 주소(실행 파일로 켠 개발 서버 등)인지. */
export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

const ID_RE = /^[0-9a-f-]{36}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 세션 링크. 지금 주소가 이 컴퓨터 전용(localhost)이면 친구가 열 수 없으므로 공개 사이트 주소로 만든다.
 * 데이터는 주소와 무관하게 브라우저끼리 직접(같은 세션 ID·비밀값) 주고받으므로 그대로 연결된다.
 */
export function sessionLink(id: string, secret: string, loc: { origin: string; pathname: string; hostname: string } = location): string {
  const base = isLocalHost(loc.hostname) ? PUBLIC_APP_URL : `${loc.origin}${loc.pathname}`;
  return `${base}#session=${id}.${secret}`;
}

/** "#session=<세션ID>.<비밀값>" 해석. 형식이 틀리면 null. */
export function parseSessionHash(hash: string): { id: string; secret: string } | null {
  const m = /^#session=([^.]+)\.(.+)$/.exec(hash);
  if (!m || !ID_RE.test(m[1]!) || !SECRET_RE.test(m[2]!)) return null;
  return { id: m[1]!, secret: m[2]! };
}

/* ---------- 관리자 ---------- */

export interface ShareState {
  /** 세션에 참여 중인지. */
  active: boolean;
  status: SessionStatus | 'local';
  peers: PeerUser[];
  missingImages: number;
  /** 세션에 포함된 맵 ID(정렬). */
  included: Id[];
  autoAdd: boolean;
}

const LOCAL: ShareState = { active: false, status: 'local', peers: [], missingImages: 0, included: [], autoAdd: true };
const EMPTY: RemoteProbe[] = [];

class ShareManager {
  private info: SessionInfo | null = null;
  private session: WorkspaceSession | null = null;
  private wsDoc: Y.Doc | null = null;
  private wsPersist: IndexeddbPersistence | null = null;
  private stateSnap: ShareState = LOCAL;
  private probesSnap = new Map<Id, RemoteProbe[]>();
  private listeners = new Set<() => void>();
  private user = getUser();
  private reconciling: Promise<void> = Promise.resolve();
  private pagehideBound = false;
  private resumed: Promise<void> | null = null;
  /** 여는 중에 다른 열기/닫기가 끼어들면 먼저 시작한 쪽을 버리기 위한 표식. */
  private openToken = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.stateSnap;
  getUser = () => this.user;

  remoteProbes(mapId: Id): RemoteProbe[] {
    return this.probesSnap.get(mapId) ?? EMPTY;
  }

  isIncluded(mapId: Id): boolean {
    return this.stateSnap.included.includes(mapId);
  }

  link(): string | null {
    return this.info ? sessionLink(this.info.id, this.info.secret) : null;
  }

  currentSessionId(): string | null {
    return this.info?.id ?? null;
  }

  setUser(user: PeerUser) {
    this.user = user;
    write('mapops.user', user);
    this.session?.setUser(user);
    this.emit();
  }

  async setRelays(urls: string[]) {
    write('mapops.relays', urls);
    if (this.info) {
      const info = this.info;
      await this.close();
      await this.open(info);
    }
  }

  /** 앱 시작 시 참여 중이던 세션에 다시 접속. 탭을 닫으면 상대에게 바로 떠남을 알린다. */
  resume(): Promise<void> {
    // 여러 번 불려도(React 개발 모드의 이중 실행 등) 한 번만 연다 — 두 번 열면 한 페이지에 세션이 둘 생겨 메시지가 엇갈린다
    this.resumed ??= (async () => {
      if (!this.pagehideBound) {
        this.pagehideBound = true;
        window.addEventListener('pagehide', () => this.session?.destroy());
      }
      const info = repo.getSession();
      if (info) await this.open(info);
    })();
    return this.resumed;
  }

  /** 새 세션을 만들고 지금 있는 맵을 모두 넣는다. */
  async start(): Promise<string> {
    if (this.info) return this.link()!;
    const info: SessionInfo = { id: newId(), secret: newSecret(), autoAdd: true };
    repo.setSession(info);
    await this.open(info);
    this.wsDoc!.transact(() => {
      for (const m of repo.getSnapshot()) this.mapsOf(this.wsDoc!).set(m.id, { addedAt: Date.now() });
    });
    return this.link()!;
  }

  /** 링크로 세션에 참여. 내 기존 맵은 자동으로 넣지 않는다(공유 창에서 골라 넣을 수 있음). */
  async join(id: string, secret: string) {
    if (this.info?.id === id) return;
    if (this.info) await this.leave();
    const info: SessionInfo = { id, secret, autoAdd: true };
    repo.setSession(info);
    await this.open(info);
  }

  /** 세션에서 나간다. 받은 맵들은 이 기기에 그대로 남는다. */
  async leave() {
    const persist = this.wsPersist;
    await this.close();
    await persist?.clearData();
    repo.setSession(null);
    // 아직 내용을 하나도 못 받은(빈) 맵은 목록에 계속 "받는 중"으로 남으므로 정리한다
    for (const id of [...repo.getPendingIds()]) await repo.deleteMap(id);
    this.emit();
  }

  /** 전체 데이터 삭제 전: 연결만 닫는다. */
  async closeAll() {
    await this.close();
  }

  /** 전체 삭제 시 함께 지울 데이터베이스 이름. */
  dbNames(): string[] {
    return this.info ? [WS_DB_PREFIX + this.info.id] : [];
  }

  include(mapId: Id) {
    if (this.wsDoc && !this.mapsOf(this.wsDoc).has(mapId)) this.mapsOf(this.wsDoc).set(mapId, { addedAt: Date.now() });
  }

  /** 세션에서 뺀다(모두에게서 빠지지만 각자의 사본은 남는다). */
  exclude(mapId: Id) {
    this.session?.detachMap(mapId);
    if (this.wsDoc) this.mapsOf(this.wsDoc).delete(mapId);
  }

  setAutoAdd(autoAdd: boolean) {
    if (!this.info) return;
    this.info = { ...this.info, autoAdd };
    repo.setSession(this.info);
    this.refresh();
  }

  /** 새 맵을 만들거나 가져왔을 때. */
  onMapCreated(mapId: Id) {
    if (this.info?.autoAdd) this.include(mapId);
  }

  /** 이 기기에서 맵을 지우기 직전. 세션에서도 뺀다(친구의 사본은 남는다). */
  onMapDeleted(mapId: Id) {
    this.exclude(mapId);
  }

  setProbe(mapId: Id, probe: { w: Vec; floorId: Id } | null) {
    this.session?.setProbe(probe && this.isIncluded(mapId) ? { mapId, ...probe } : null);
  }

  /* ---------- 내부 ---------- */

  private mapsOf(doc: Y.Doc) {
    return doc.getMap<{ addedAt: number }>('maps');
  }

  private async open(info: SessionInfo) {
    const token = ++this.openToken;
    this.session?.destroy(); // 혹시 남아 있는 세션은 닫는다(한 페이지에 하나만)
    this.session = null;
    this.info = info;
    const wsDoc = new Y.Doc();
    const persist = new IndexeddbPersistence(WS_DB_PREFIX + info.id, wsDoc);
    await persist.whenSynced;
    if (token !== this.openToken) {
      // 그사이 다른 열기/닫기가 시작됨 — 이 시도는 버린다
      wsDoc.destroy();
      await persist.destroy();
      return;
    }
    this.wsDoc = wsDoc;
    this.wsPersist = persist;
    this.session = new WorkspaceSession({
      sessionId: info.id,
      secret: info.secret,
      wsDoc,
      relays: getRelays(),
      user: this.user,
      onChange: () => this.refresh(),
    });
    this.mapsOf(wsDoc).observe(() => this.scheduleReconcile());
    this.scheduleReconcile();
    await this.reconciling;
  }

  private async close() {
    this.openToken++; // 진행 중인 열기를 무효화
    this.session?.destroy();
    this.session = null;
    this.wsDoc?.destroy();
    this.wsDoc = null;
    await this.wsPersist?.destroy();
    this.wsPersist = null;
    this.info = null;
    this.stateSnap = LOCAL;
    this.probesSnap = new Map();
    this.emit();
  }

  /** 세션 목록과 실제로 붙어 있는 맵을 맞춘다(동시에 여러 번 돌지 않도록 이어서 실행). */
  private scheduleReconcile() {
    this.reconciling = this.reconciling.then(() => this.reconcile()).catch((e) => console.error('[share] 맵 동기화 준비 실패', e));
  }

  private async reconcile() {
    const session = this.session;
    const wsDoc = this.wsDoc;
    if (!session || !wsDoc) return;
    const wanted = new Set(this.mapsOf(wsDoc).keys());
    for (const id of wanted) {
      if (session.attachedMaps().includes(id)) continue;
      const doc = repo.getDoc(id) ?? (await repo.joinMap(id));
      if (this.session !== session) return; // 그사이 세션이 바뀜
      session.attachMap(id, doc);
    }
    for (const id of session.attachedMaps()) if (!wanted.has(id)) session.detachMap(id);
    this.refresh();
  }

  private refresh() {
    const s = this.session;
    if (!s || !this.info || !this.wsDoc) {
      if (this.stateSnap !== LOCAL) {
        this.stateSnap = LOCAL;
        this.emit();
      }
      return;
    }
    const next: ShareState = {
      active: true,
      status: s.status(),
      peers: s.peers().map((p) => p.user),
      missingImages: s.missingImages(),
      included: [...this.mapsOf(this.wsDoc).keys()].sort(),
      autoAdd: this.info.autoAdd,
    };
    let changed = false;
    if (JSON.stringify(next) !== JSON.stringify(this.stateSnap)) {
      this.stateSnap = next;
      changed = true;
    }
    const byMap = new Map<Id, RemoteProbe[]>();
    for (const p of s.remoteProbes()) byMap.set(p.mapId, [...(byMap.get(p.mapId) ?? []), p]);
    for (const [mapId, list] of byMap) {
      if (JSON.stringify(list) !== JSON.stringify(this.probesSnap.get(mapId) ?? [])) {
        this.probesSnap.set(mapId, list);
        changed = true;
      }
    }
    for (const mapId of [...this.probesSnap.keys()]) {
      if (!byMap.has(mapId)) {
        this.probesSnap.delete(mapId);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const shareManager = new ShareManager();

export function useShareState(): ShareState {
  return useSyncExternalStore(shareManager.subscribe, shareManager.getState);
}

export function useRemoteProbes(mapId: Id): RemoteProbe[] {
  return useSyncExternalStore(shareManager.subscribe, () => shareManager.remoteProbes(mapId));
}
