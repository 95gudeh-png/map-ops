import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocMux, type MuxMeta } from './docMux';

/** 메모리 안에서 여러 참가자를 잇는 가짜 네트워크(동기 전달). */
function network() {
  const nodes = new Map<string, DocMux>();
  const online = new Set<string>();
  const add = (id: string) => {
    const mux = new DocMux((data: Uint8Array, meta: MuxMeta, target?: string) => {
      for (const [other, m] of nodes) {
        if (other === id || !online.has(other) || !online.has(id)) continue;
        if (target && target !== other) continue;
        m.receive(data, meta, id);
      }
    });
    nodes.set(id, mux);
    return mux;
  };
  const connect = (id: string) => {
    online.add(id);
    for (const other of online) {
      if (other === id) continue;
      nodes.get(id)!.peerJoined(other);
      nodes.get(other)!.peerJoined(id);
    }
  };
  const disconnect = (id: string) => online.delete(id);
  return { add, connect, disconnect };
}

const text = (doc: Y.Doc) => doc.getMap('m').toJSON();

describe('DocMux', () => {
  it('접속하면 여러 문서가 양방향으로 맞춰진다', () => {
    const net = network();
    const a = net.add('A'), b = net.add('B');
    const a1 = new Y.Doc(), a2 = new Y.Doc(), b1 = new Y.Doc(), b2 = new Y.Doc();
    a1.getMap('m').set('x', 'A가 쓴 1');
    b2.getMap('m').set('y', 'B가 쓴 2');
    a.attach('doc1', a1); a.attach('doc2', a2);
    b.attach('doc1', b1); b.attach('doc2', b2);
    net.connect('A'); net.connect('B');
    expect(text(b1)).toEqual({ x: 'A가 쓴 1' });
    expect(text(a2)).toEqual({ y: 'B가 쓴 2' });
  });

  it('접속 중 변경은 바로 전달된다', () => {
    const net = network();
    const a = net.add('A'), b = net.add('B');
    const ad = new Y.Doc(), bd = new Y.Doc();
    a.attach('k', ad); b.attach('k', bd);
    net.connect('A'); net.connect('B');
    ad.getMap('m').set('live', 1);
    expect(text(bd)).toEqual({ live: 1 });
  });

  it('나중에 붙인 문서도 접속 중인 상대와 맞춰진다(세션에 새 맵 추가)', () => {
    const net = network();
    const a = net.add('A'), b = net.add('B');
    net.connect('A'); net.connect('B');
    const ad = new Y.Doc(); ad.getMap('m').set('new', 'map');
    const bd = new Y.Doc();
    b.attach('late', bd); // B가 먼저 빈 문서로 대기
    a.attach('late', ad); // A가 붙이면 서로 sv 교환
    expect(text(bd)).toEqual({ new: 'map' });
  });

  it('붙이지 않은 문서에 대한 메시지는 무시한다', () => {
    const net = network();
    const a = net.add('A'), b = net.add('B');
    const ad = new Y.Doc(); ad.getMap('m').set('secret', 1);
    a.attach('only-a', ad);
    net.connect('A'); net.connect('B');
    expect(b.keys()).toEqual([]);
  });

  it('떨어져 있는 동안 바뀐 내용은 다시 접속하면 병합된다', () => {
    const net = network();
    const a = net.add('A'), b = net.add('B');
    const ad = new Y.Doc(), bd = new Y.Doc();
    a.attach('k', ad); b.attach('k', bd);
    net.connect('A'); net.connect('B');
    net.disconnect('B');
    ad.getMap('m').set('fromA', 1);
    bd.getMap('m').set('fromB', 2);
    net.connect('B');
    expect(text(ad)).toEqual({ fromA: 1, fromB: 2 });
    expect(text(bd)).toEqual({ fromA: 1, fromB: 2 });
  });

  it('떼어 낸 문서는 더 이상 보내지도 받지도 않는다', () => {
    const net = network();
    const a = net.add('A'), b = net.add('B');
    const ad = new Y.Doc(), bd = new Y.Doc();
    a.attach('k', ad); b.attach('k', bd);
    net.connect('A'); net.connect('B');
    b.detach('k');
    ad.getMap('m').set('after', 1);
    expect(text(bd)).toEqual({});
  });
});
