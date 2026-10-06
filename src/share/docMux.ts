/**
 * 여러 Y.Doc을 연결 하나로 동기화하는 다중화기. 전송 수단과 무관하므로 단위 테스트할 수 있다.
 *
 * 메시지: 데이터(Uint8Array) + 메타 { t: 'sv'|'up', d: 문서 키, f?: 첫 요청 여부 }
 * - sv(상태 벡터)를 받으면 그 차이(up)를 돌려준다. f=true면 내 sv도 보내서 상대가 모자란 부분을 받게 한다.
 * - 로컬 변경은 up으로 모두에게 보낸다.
 * - 붙이지 않은(attach 안 한) 문서에 대한 메시지는 무시한다(모르는 문서를 함부로 만들지 않음).
 */
import * as Y from 'yjs';

export interface MuxMeta {
  t: 'sv' | 'up';
  d: string;
  f?: boolean;
}

export type MuxSend = (data: Uint8Array, meta: MuxMeta, target?: string) => void;

export class DocMux {
  private docs = new Map<string, { doc: Y.Doc; off: () => void }>();

  constructor(private send: MuxSend) {}

  has(key: string) {
    return this.docs.has(key);
  }

  keys(): string[] {
    return [...this.docs.keys()];
  }

  /** 문서를 붙이고, 접속한 모두에게 상태 벡터를 보내 서로 모자란 부분을 맞춘다. */
  attach(key: string, doc: Y.Doc) {
    if (this.docs.has(key)) return;
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== this) this.send(update, { t: 'up', d: key });
    };
    doc.on('update', onUpdate);
    this.docs.set(key, { doc, off: () => doc.off('update', onUpdate) });
    this.send(Y.encodeStateVector(doc), { t: 'sv', d: key, f: true });
  }

  detach(key: string) {
    this.docs.get(key)?.off();
    this.docs.delete(key);
  }

  detachAll() {
    for (const key of this.keys()) this.detach(key);
  }

  /** 새로 접속한 사람에게 모든 문서의 상태 벡터를 보낸다(상대도 같은 일을 하므로 양방향으로 맞춰진다). */
  peerJoined(peerId: string) {
    for (const [key, { doc }] of this.docs) this.send(Y.encodeStateVector(doc), { t: 'sv', d: key }, peerId);
  }

  receive(data: Uint8Array, meta: MuxMeta, from: string) {
    const entry = this.docs.get(meta.d);
    if (!entry) return;
    if (meta.t === 'sv') {
      this.send(Y.encodeStateAsUpdate(entry.doc, data), { t: 'up', d: meta.d }, from);
      if (meta.f) this.send(Y.encodeStateVector(entry.doc), { t: 'sv', d: meta.d }, from);
    } else if (meta.t === 'up') {
      Y.applyUpdate(entry.doc, data, this);
    }
  }
}
