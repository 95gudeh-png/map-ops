/**
 * 맵 하나의 실시간 공유 세션 (명세서 §4.5).
 *
 * 연결: Trystero(Nostr 공개 릴레이로 서로를 찾은 뒤 브라우저끼리 WebRTC 직접 연결). 서버·계정 불필요.
 * 방 암호(password)로 연결 협상이 암호화되고, 데이터는 WebRTC(DTLS)로 암호화된다.
 *
 * - 'sync'  : Yjs 상태 벡터(sv) / 업데이트(up) 교환 → 맵 문서 병합(CRDT)
 * - 'aw'    : y-protocols awareness(접속자 이름·색, 선택 위치, 필요한 이미지)
 * - 'img'   : 요청/응답. 해시를 요청하면 원본 바이트로 답한다(Trystero가 큰 데이터를 나눠 보냄).
 *             받은 쪽은 해시를 다시 계산해 일치할 때만 저장한다.
 */
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { getRelaySockets, joinRoom, type Room } from 'trystero';
import type { Vec } from '../geometry';
import type { Id } from '../model';
import { getImage, putReceivedImage } from '../store/imageStore';
import { readMap } from '../store/mapDoc';

const APP_ID = 'map-ops/v1';
const REMOTE = Symbol('remote');

export interface PeerUser {
  name: string;
  color: string;
}

export interface RemoteProbe {
  clientId: number;
  user: PeerUser;
  w: Vec;
  floorId: Id;
}

interface AwarenessState {
  user?: PeerUser;
  probe?: { w: Vec; floorId: Id } | null;
  need?: string[];
}

export type SessionStatus = 'connecting' | 'online' | 'offline';

export interface SessionOptions {
  mapId: Id;
  doc: Y.Doc;
  secret: string;
  relays?: string[];
  user: PeerUser;
  onChange: () => void;
}

type SyncMeta = { t: 'sv' | 'up' };

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

export class ShareSession {
  readonly mapId: Id;
  private doc: Y.Doc;
  private room: Room;
  private awareness: awarenessProtocol.Awareness;
  private sync;
  private aw;
  private img;
  /** peerId → 그 사람의 awareness clientID들(떠나면 상태 제거). */
  private peerClients = new Map<string, Set<number>>();
  private receivingFrom: string | null = null;
  private need = new Set<string>();
  private fetching = new Set<string>();
  private destroyed = false;
  private timer: number;
  private onChange: () => void;

  constructor(o: SessionOptions) {
    this.mapId = o.mapId;
    this.doc = o.doc;
    this.onChange = o.onChange;
    this.awareness = new awarenessProtocol.Awareness(o.doc);
    this.awareness.setLocalState({ user: o.user, probe: null, need: [] } satisfies AwarenessState);

    this.room = joinRoom(
      { appId: APP_ID, password: o.secret, ...(o.relays?.length ? { relayConfig: { urls: o.relays } } : {}) },
      o.mapId,
      { onJoinError: (e) => console.warn('[share] 참여 오류', e.error) },
    );

    this.sync = this.room.makeAction<Uint8Array>('sync', {
      onMessage: (data, ctx) => {
        const bytes = toBytes(data);
        const meta = ctx.metadata as SyncMeta | undefined;
        if (!bytes || !meta) return;
        if (meta.t === 'sv') {
          // 상대가 가진 상태와의 차이만 돌려준다
          void this.sync.send(Y.encodeStateAsUpdate(this.doc, bytes), { target: ctx.peerId, metadata: { t: 'up' } });
        } else if (meta.t === 'up') {
          Y.applyUpdate(this.doc, bytes, REMOTE);
        }
      },
    });

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
      // 서로 상태 벡터를 보내면 양쪽이 각자 모자란 부분을 받는다
      void this.sync.send(Y.encodeStateVector(this.doc), { target: peerId, metadata: { t: 'sv' } });
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

    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.awareness.on('change', this.onAwarenessChange);
    // 릴레이 연결 상태는 이벤트가 없어 주기적으로 확인
    this.timer = window.setInterval(() => this.onChange(), 2000);
    void this.refreshNeed();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    window.clearInterval(this.timer);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.setLocalState(null); // 떠남을 알림
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.off('change', this.onAwarenessChange);
    this.awareness.destroy();
    void this.room.leave();
  }

  /* ---------- 이벤트 ---------- */

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE && this.peerCount() > 0) void this.sync.send(update, { metadata: { t: 'up' } });
    void this.refreshNeed();
  };

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

  setProbe(probe: { w: Vec; floorId: Id } | null) {
    this.awareness.setLocalStateField('probe', probe);
  }

  setUser(user: PeerUser) {
    this.awareness.setLocalStateField('user', user);
  }

  /* ---------- 이미지 ---------- */

  /** 맵이 참조하는 이미지 중 로컬에 없는 것을 찾는다. */
  private async refreshNeed() {
    const map = readMap(this.doc, this.mapId);
    const missing = new Set<string>();
    for (const f of map?.floors ?? []) if (!(await getImage(f.imageId))) missing.add(f.imageId);
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
