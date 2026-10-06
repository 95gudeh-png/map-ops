/**
 * 공유 세션 하나(명세서 §4.5 — 세션 단위 공유). 방 하나로 세션의 모든 맵을 함께 동기화한다.
 *
 * 연결: Trystero(Nostr 공개 릴레이로 서로를 찾은 뒤 브라우저끼리 WebRTC 직접 연결). 서버·계정 불필요.
 * 방 암호(password)로 연결 협상이 암호화되고, 데이터는 WebRTC(DTLS)로 암호화된다.
 *
 * - 'sync' : DocMux로 여러 Y.Doc(세션 목록 'ws' + 맵들) 다중화
 * - 'aw'   : y-protocols awareness(접속자 이름·색, 선택 위치(맵 ID 포함), 필요한 이미지)
 * - 'img'  : 요청/응답. 해시를 요청하면 원본 바이트로 답한다. 받은 쪽은 해시를 검증한다.
 */
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { getRelaySockets, joinRoom, type Room } from 'trystero';
import type { Vec } from '../geometry';
import type { Id } from '../model';
import { getImage, putReceivedImage } from '../store/imageStore';
import { readMap } from '../store/mapDoc';
import { DocMux, type MuxMeta } from './docMux';

const APP_ID = 'map-ops/v2';
const REMOTE = Symbol('remote');
/** 세션 목록 문서의 다중화 키. */
export const WS_KEY = 'ws';

export interface PeerUser {
  name: string;
  color: string;
}

export interface RemoteProbe {
  clientId: number;
  user: PeerUser;
  mapId: Id;
  w: Vec;
  floorId: Id;
}

export interface ProbeState {
  mapId: Id;
  w: Vec;
  floorId: Id;
}

interface AwarenessState {
  user?: PeerUser;
  probe?: ProbeState | null;
  need?: string[];
}

export type SessionStatus = 'connecting' | 'online' | 'offline';

export interface SessionOptions {
  sessionId: string;
  secret: string;
  /** 세션 목록 문서(포함된 맵 ID). */
  wsDoc: Y.Doc;
  relays?: string[];
  user: PeerUser;
  onChange: () => void;
}

/** 파일 머리 바이트로 이미지 형식 추정(전송 시 MIME이 따라오지 않으므로). */
export function sniffImageType(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return 'application/octet-stream';
}

const toBytes = (data: unknown): Uint8Array<ArrayBuffer> | null => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  return null;
};

export class WorkspaceSession {
  readonly sessionId: string;
  private room: Room;
  private mux: DocMux;
  private awareness: awarenessProtocol.Awareness;
  private sync;
  private aw;
  private img;
  /** 이미지 확인 대상 맵 문서들. */
  private mapDocs = new Map<Id, Y.Doc>();
  private peerClients = new Map<string, Set<number>>();
  private receivingFrom: string | null = null;
  private need = new Set<string>();
  private fetching = new Set<string>();
  private destroyed = false;
  private timer: number;
  private onChange: () => void;

  constructor(o: SessionOptions) {
    this.sessionId = o.sessionId;
    this.onChange = o.onChange;
    // awareness는 세션 목록 문서에 묶는다(맵 문서와 수명이 독립)
    this.awareness = new awarenessProtocol.Awareness(o.wsDoc);
    this.awareness.setLocalState({ user: o.user, probe: null, need: [] } satisfies AwarenessState);

    this.room = joinRoom(
      { appId: APP_ID, password: o.secret, ...(o.relays?.length ? { relayConfig: { urls: o.relays } } : {}) },
      o.sessionId,
      { onJoinError: (e) => console.warn('[share] 참여 오류', e.error) },
    );

    this.sync = this.room.makeAction<Uint8Array>('sync', {
      onMessage: (data, ctx) => {
        const bytes = toBytes(data);
        const meta = ctx.metadata as MuxMeta | undefined;
        if (bytes && meta && typeof meta.d === 'string') this.mux.receive(bytes, meta, ctx.peerId);
      },
    });
    this.mux = new DocMux((data, meta, target) => {
      if (this.peerCount() === 0) return;
      void this.sync.send(data, { metadata: { ...meta }, ...(target ? { target } : {}) });
    });
    this.mux.attach(WS_KEY, o.wsDoc);

    this.aw = this.room.makeAction<Uint8Array>('aw', {
      onMessage: (data, ctx) => {
        const bytes = toBytes(data);
        if (!bytes) return;
        this.receivingFrom = ctx.peerId;
        try {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, bytes, REMOTE);
        } finally {
          this.receivingFrom = null;
        }
      },
    });

    this.img = this.room.makeAction<string, ArrayBuffer>('img', {
      kind: 'request',
      onRequest: async (hash) => {
        const rec = typeof hash === 'string' ? await getImage(hash) : undefined;
        if (!rec) throw new Error('없는 이미지');
        return rec.blob.arrayBuffer();
      },
    });

    this.room.onPeerJoin = (peerId) => {
      this.mux.peerJoined(peerId);
      void this.aw.send(awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(this.awareness.getStates().keys())), { target: peerId });
      void this.fetchMissing();
      this.onChange();
    };
    this.room.onPeerLeave = (peerId) => {
      const ids = this.peerClients.get(peerId);
      this.peerClients.delete(peerId);
      if (ids?.size) awarenessProtocol.removeAwarenessStates(this.awareness, [...ids], REMOTE);
      this.onChange();
    };

    this.awareness.on('update', this.onAwarenessUpdate);
    this.awareness.on('change', this.onAwarenessChange);
    this.timer = window.setInterval(() => this.onChange(), 2000);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearInterval(this.timer);
    for (const doc of this.mapDocs.values()) doc.off('update', this.onMapUpdate);
    this.mapDocs.clear();
    this.mux.detachAll();
    this.awareness.setLocalState(null); // 떠남을 알림
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.off('change', this.onAwarenessChange);
    this.awareness.destroy();
    void this.room.leave();
  }

  /* ---------- 맵 붙이기/떼기 ---------- */

  attachMap(mapId: Id, doc: Y.Doc) {
    if (this.mapDocs.has(mapId)) return;
    this.mapDocs.set(mapId, doc);
    doc.on('update', this.onMapUpdate);
    this.mux.attach(mapId, doc);
    void this.refreshNeed();
  }

  detachMap(mapId: Id) {
    this.mapDocs.get(mapId)?.off('update', this.onMapUpdate);
    this.mapDocs.delete(mapId);
    this.mux.detach(mapId);
    void this.refreshNeed();
  }

  attachedMaps(): Id[] {
    return [...this.mapDocs.keys()];
  }

  /* ---------- 상태 ---------- */

  private peerCount() {
    return Object.keys(this.room.getPeers()).length;
  }

  status(): SessionStatus {
    const sockets = Object.values((getRelaySockets as () => Record<string, WebSocket>)() ?? {});
    if (sockets.some((s) => s.readyState === WebSocket.OPEN)) return 'online';
    return sockets.length ? 'connecting' : 'offline';
  }

  peers(): { clientId: number; user: PeerUser }[] {
    const out: { clientId: number; user: PeerUser }[] = [];
    this.awareness.getStates().forEach((s: AwarenessState, id) => {
      if (id !== this.awareness.clientID && s.user) out.push({ clientId: id, user: s.user });
    });
    return out;
  }

  remoteProbes(): RemoteProbe[] {
    const out: RemoteProbe[] = [];
    this.awareness.getStates().forEach((s: AwarenessState, id) => {
      if (id !== this.awareness.clientID && s.user && s.probe) out.push({ clientId: id, user: s.user, ...s.probe });
    });
    return out;
  }

  missingImages(): number {
    return this.need.size;
  }

  setProbe(probe: ProbeState | null) {
    this.awareness.setLocalStateField('probe', probe);
  }

  setUser(user: PeerUser) {
    this.awareness.setLocalStateField('user', user);
  }

  /* ---------- awareness ---------- */

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === REMOTE) {
      const peer = this.receivingFrom;
      if (peer) {
        const set = this.peerClients.get(peer) ?? new Set<number>();
        for (const id of [...added, ...updated]) set.add(id);
        for (const id of removed) set.delete(id);
        this.peerClients.set(peer, set);
      }
      return;
    }
    const changed = [...added, ...updated, ...removed];
    if (changed.length && this.peerCount() > 0) void this.aw.send(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
  };

  private onAwarenessChange = () => this.onChange();

  /* ---------- 이미지 ---------- */

  private onMapUpdate = () => void this.refreshNeed();

  /** 세션 맵들이 참조하는 이미지 중 로컬에 없는 것을 찾는다. */
  private async refreshNeed() {
    const missing = new Set<string>();
    for (const [mapId, doc] of this.mapDocs) {
      for (const f of readMap(doc, mapId)?.floors ?? []) if (!(await getImage(f.imageId))) missing.add(f.imageId);
    }
    if (this.destroyed) return;
    const changed = missing.size !== this.need.size || [...missing].some((id) => !this.need.has(id));
    this.need = missing;
    if (changed) {
      this.awareness.setLocalStateField('need', [...missing]);
      this.onChange();
      void this.fetchMissing();
    }
  }

  /** 없는 이미지를 접속한 사람들에게 차례로 요청한다. */
  private async fetchMissing() {
    const peers = Object.keys(this.room.getPeers());
    if (peers.length === 0) return;
    for (const hash of this.need) {
      if (this.fetching.has(hash)) continue;
      this.fetching.add(hash);
      void (async () => {
        try {
          for (const peer of peers) {
            try {
              const data = await this.img.request(hash, { target: peer, timeoutMs: 60_000 });
              const bytes = toBytes(data);
              if (bytes && (await putReceivedImage(hash, bytes, sniffImageType(bytes)))) break;
            } catch {
              /* 이 사람에게 없음 — 다음 사람 */
            }
          }
        } finally {
          this.fetching.delete(hash);
          if (!this.destroyed) void this.refreshNeed();
        }
      })();
    }
  }
}
