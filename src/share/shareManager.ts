/** 공유 세션 관리: 시작·중지·참여, 앱 시작 시 재접속, 기기별 설정(이름·색·시그널링). */
import { useSyncExternalStore } from 'react';
import type { Vec } from '../geometry';
import type { Id } from '../model';
import { repo } from '../store/repo';
import { ShareSession, type PeerUser, type RemoteProbe, type SessionStatus } from './session';

const COLORS = ['#e0a83e', '#4fbf83', '#c678dd', '#e0555a', '#56b6c2', '#ff9f43'];

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

const ID_RE = /^[0-9a-f-]{36}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 친구가 열 수 있는 공개 주소(GitHub Pages). */
export const PUBLIC_APP_URL = 'https://95gudeh-png.github.io/map-ops/';

/** 이 컴퓨터에서만 열리는 주소(실행 파일로 켠 개발 서버 등)인지. */
export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/**
 * 공유 링크. 지금 주소가 이 컴퓨터 전용(localhost)이면 친구가 열 수 없으므로 공개 사이트 주소로 만든다.
 * 맵 데이터는 주소와 무관하게 브라우저끼리 직접(같은 방 ID·비밀값) 주고받으므로 그대로 연결된다.
 */
export function shareLink(mapId: Id, secret: string, loc: { origin: string; pathname: string; hostname: string } = location): string {
  const base = isLocalHost(loc.hostname) ? PUBLIC_APP_URL : `${loc.origin}${loc.pathname}`;
  return `${base}#join=${mapId}.${secret}`;
}

/** "#join=<mapId>.<secret>" 해석. 형식이 틀리면 null. */
export function parseJoinHash(hash: string): { mapId: Id; secret: string } | null {
  const m = /^#join=([^.]+)\.(.+)$/.exec(hash);
  if (!m || !ID_RE.test(m[1]!) || !SECRET_RE.test(m[2]!)) return null;
  return { mapId: m[1]!, secret: m[2]! };
}

/* ---------- 관리자 ---------- */

export interface ShareState {
  shared: boolean;
  status: SessionStatus | 'local';
  peers: PeerUser[];
  missingImages: number;
}

const LOCAL: ShareState = { shared: false, status: 'local', peers: [], missingImages: 0 };

class ShareManager {
  private sessions = new Map<Id, ShareSession>();
  private states = new Map<Id, ShareState>();
  private probes = new Map<Id, RemoteProbe[]>();
  private listeners = new Set<() => void>();
  private user = getUser();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  state(mapId: Id): ShareState {
    return this.states.get(mapId) ?? LOCAL;
  }

  remoteProbes(mapId: Id): RemoteProbe[] {
    return this.probes.get(mapId) ?? EMPTY;
  }

  getUser = () => this.user;

  setUser(user: PeerUser) {
    this.user = user;
    write('mapops.user', user);
    for (const s of this.sessions.values()) s.setUser(user);
    this.emit();
  }

  setRelays(urls: string[]) {
    write('mapops.relays', urls);
    // 열린 세션은 새 서버로 다시 연결
    for (const id of [...this.sessions.keys()]) {
      this.close(id);
      this.open(id);
    }
  }

  /** 앱 시작 시 공유 중이던 맵에 다시 접속. 탭을 닫으면 상대에게 바로 떠남을 알린다. */
  resumeAll() {
    for (const id of repo.sharedIds()) this.open(id);
    window.addEventListener('pagehide', () => {
      for (const id of [...this.sessions.keys()]) this.close(id);
    });
  }

  /** 모든 세션 종료(전체 데이터 삭제 전). */
  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id);
    this.emit();
  }

  start(mapId: Id): string {
    const share = repo.getShare(mapId) ?? { secret: newSecret() };
    repo.setShare(mapId, share);
    this.open(mapId);
    return shareLink(mapId, share.secret);
  }

  stop(mapId: Id) {
    this.close(mapId);
    repo.setShare(mapId, null);
    this.emit();
  }

  async join(mapId: Id, secret: string) {
    await repo.joinMap(mapId, { secret });
    this.close(mapId);
    this.open(mapId);
  }

  link(mapId: Id): string | null {
    const share = repo.getShare(mapId);
    return share ? shareLink(mapId, share.secret) : null;
  }

  setProbe(mapId: Id, probe: { w: Vec; floorId: Id } | null) {
    this.sessions.get(mapId)?.setProbe(probe);
  }

  private open(mapId: Id) {
    if (this.sessions.has(mapId)) return;
    const share = repo.getShare(mapId);
    const doc = repo.getDoc(mapId);
    if (!share || !doc) return;
    const session = new ShareSession({
      mapId,
      doc,
      secret: share.secret,
      relays: getRelays(),
      user: this.user,
      onChange: () => this.refresh(mapId),
    });
    this.sessions.set(mapId, session);
    this.refresh(mapId);
  }

  private close(mapId: Id) {
    this.sessions.get(mapId)?.destroy();
    this.sessions.delete(mapId);
    this.states.delete(mapId);
    this.probes.delete(mapId);
  }

  private refresh(mapId: Id) {
    const s = this.sessions.get(mapId);
    if (!s) return;
    const prev = this.states.get(mapId);
    const next: ShareState = {
      shared: true,
      status: s.status(),
      peers: s.peers().map((p) => p.user),
      missingImages: s.missingImages(),
    };
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) this.states.set(mapId, next);
    const probes = s.remoteProbes();
    if (JSON.stringify(probes) !== JSON.stringify(this.probes.get(mapId) ?? [])) this.probes.set(mapId, probes);
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

const EMPTY: RemoteProbe[] = [];

export const shareManager = new ShareManager();

export function useShareState(mapId: Id | undefined): ShareState {
  return useSyncExternalStore(shareManager.subscribe, () => (mapId ? shareManager.state(mapId) : LOCAL));
}

export function useRemoteProbes(mapId: Id): RemoteProbe[] {
  return useSyncExternalStore(shareManager.subscribe, () => shareManager.remoteProbes(mapId));
}
