import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { vec } from '../geometry';
import type { GameMap, Marker } from '../model';
import { readMap, writeMap } from './mapDoc';
import { base64ToBytes, buildBundle, bytesToBase64, MAPOPS_FORMAT, parseMapops } from './mapopsFile';
import { Repo } from './repo';

function sample(id = 'map-1'): GameMap {
  return {
    id,
    name: '은행',
    anchorFloorId: 'F1',
    floors: [
      { id: 'F1', name: '1층', imageId: 'h1', imageW: 1000, imageH: 800, sim: { r: 1, d: vec(0, 0) }, r0: 1 },
      { id: 'F2', name: '2층', imageId: 'h2', imageW: 2000, imageH: 1600, sim: { r: 0.5, d: vec(10, -5) }, r0: 0.5 },
    ],
    markers: [
      { id: 'm1', type: 'camera', label: '카메라', scope: { kind: 'floor', floorId: 'F1', p: vec(1, 2) }, createdAt: 1 },
      { id: 'm2', type: 'connector', label: '해치', scope: { kind: 'through', floorIds: ['F1', 'F2'], w: vec(3, 4) }, createdAt: 2 },
    ],
    strokes: [],
    updatedAt: 100,
  };
}

const marker = (id: string, createdAt: number): Marker => ({
  id,
  type: 'note',
  label: id,
  scope: { kind: 'floor', floorId: 'F1', p: vec(0, 0) },
  createdAt,
});

describe('mapDoc', () => {
  it('쓰고 읽으면 같은 맵', () => {
    const doc = new Y.Doc();
    writeMap(doc, sample());
    expect(readMap(doc, 'map-1')).toEqual(sample());
  });

  it('낙서와 마커 설정도 저장된다', () => {
    const doc = new Y.Doc();
    const m: GameMap = {
      ...sample(),
      strokes: [{ id: 's1', floorId: 'F2', color: '#ffffff', width: 3, points: [1, 2, 3, 4], createdAt: 5 }],
      markerStyle: { size: 1.6, opacity: 0.7, outline: 'light', labelSize: 14, colors: { note: '#123456' } },
    };
    writeMap(doc, m);
    expect(readMap(doc, 'map-1')).toEqual(m);
    // strokes 필드가 없는 객체로 저장해도 기존 낙서는 유지(이전 버전 호환)
    const { strokes: _omit, ...legacy } = m;
    void _omit;
    writeMap(doc, legacy);
    expect(readMap(doc, 'map-1')!.strokes).toHaveLength(1);
  });

  it('층 순서 변경과 삭제가 반영된다', () => {
    const doc = new Y.Doc();
    const m = sample();
    writeMap(doc, m);
    writeMap(doc, { ...m, floors: [m.floors[1]!, m.floors[0]!], markers: [m.markers[0]!] });
    const back = readMap(doc, 'map-1')!;
    expect(back.floors.map((f) => f.id)).toEqual(['F2', 'F1']);
    expect(back.markers.map((x) => x.id)).toEqual(['m1']);
  });

  it('바뀌지 않은 항목은 다시 쓰지 않는다', () => {
    const doc = new Y.Doc();
    writeMap(doc, sample());
    let updates = 0;
    doc.getMap('markers').observe(() => updates++);
    doc.getMap('floors').observe(() => updates++);
    writeMap(doc, { ...sample(), updatedAt: 200 });
    expect(updates).toBe(0);
  });

  it('두 사람이 동시에 서로 다른 마커를 추가하면 둘 다 남는다', () => {
    const a = new Y.Doc();
    writeMap(a, sample());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const ma = readMap(a, 'map-1')!;
    writeMap(a, { ...ma, markers: [...ma.markers, marker('fromA', 10)] });
    const mb = readMap(b, 'map-1')!;
    writeMap(b, { ...mb, markers: [...mb.markers, marker('fromB', 11)] });

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ids = readMap(a, 'map-1')!.markers.map((x) => x.id);
    expect(ids).toEqual(['m1', 'm2', 'fromA', 'fromB']);
    expect(readMap(b, 'map-1')).toEqual(readMap(a, 'map-1'));
  });
});

describe('.mapops 파일', () => {
  it('base64 왕복', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  const file = () => ({
    format: MAPOPS_FORMAT,
    version: 1,
    exportedAt: 0,
    map: sample(),
    images: { h1: { type: 'image/png', w: 1000, h: 800, data: 'AA==' }, h2: { type: 'image/png', w: 2000, h: 1600, data: 'AA==' } },
  });

  it('올바른 파일은 통과', () => {
    expect(parseMapops(JSON.stringify(file())).maps[0]!.name).toBe('은행');
    const withExtras = {
      ...file(),
      map: {
        ...sample(),
        strokes: [{ id: 's', floorId: 'F1', color: '#ff4d4f', width: 3, points: [0, 0, 5, 5], createdAt: 1 }],
        markerStyle: { size: 1.5, opacity: 0.8, outline: 'light', labelSize: 13, colors: { camera: '#00ff00' } },
      },
    };
    expect(parseMapops(JSON.stringify(withExtras)).maps[0]!.strokes).toHaveLength(1);
  });

  it('묶음 파일(버전 2)은 여러 맵을 읽고, 버전 1 낱개 파일도 계속 읽는다', () => {
    const images = file().images;
    const bundle = buildBundle([sample('m-a'), { ...sample('m-b'), name: '공항' }], images);
    const parsed = parseMapops(JSON.stringify(bundle));
    expect(parsed.maps.map((m) => m.name)).toEqual(['은행', '공항']);
    expect(parseMapops(JSON.stringify(file())).maps).toHaveLength(1); // file()은 버전 1 형식
  });

  it('묶음 안에 같은 맵이 두 번 있으면 거부', () => {
    const bundle = buildBundle([sample('dup'), sample('dup')], file().images);
    expect(() => parseMapops(JSON.stringify(bundle))).toThrow(/같은 맵이 두 번/);
  });

  it.each([
    ['JSON 아님', 'not json'],
    ['형식 표시 없음', JSON.stringify({ ...file(), format: 'x' })],
    ['이미지 누락', JSON.stringify({ ...file(), images: { h1: file().images.h1 } })],
    ['없는 층을 가리키는 마커', JSON.stringify({ ...file(), map: { ...sample(), markers: [{ ...marker('x', 0), scope: { kind: 'floor', floorId: 'NOPE', p: vec(0, 0) } }] } })],
    ['기준층 없음', JSON.stringify({ ...file(), map: { ...sample(), anchorFloorId: 'NOPE' } })],
    ['음수 배율', JSON.stringify({ ...file(), map: { ...sample(), floors: [{ ...sample().floors[0]!, sim: { r: -1, d: vec(0, 0) } }] } })],
    ['잘못된 낙서 색', JSON.stringify({ ...file(), map: { ...sample(), strokes: [{ id: 's', floorId: 'F1', color: 'red;x', width: 2, points: [0, 0], createdAt: 0 }] } })],
    ['홀수 좌표 낙서', JSON.stringify({ ...file(), map: { ...sample(), strokes: [{ id: 's', floorId: 'F1', color: '#ffffff', width: 2, points: [0, 0, 1], createdAt: 0 }] } })],
    ['마커 크기 범위 밖', JSON.stringify({ ...file(), map: { ...sample(), markerStyle: { size: 99, opacity: 1, outline: 'dark', labelSize: 11, colors: {} } } })],
  ])('잘못된 파일 거부: %s', (_, text) => {
    expect(() => parseMapops(text)).toThrow(/올바른 \.mapops 파일이 아니오/);
  });
});

describe('Repo 전체 삭제', () => {
  it('wipeAll 후 새로 열면 맵과 데이터베이스가 모두 없다', async () => {
    const r1 = new Repo();
    await r1.init();
    await r1.createMap(sample('wipe-1'));
    await r1.createMap(sample('wipe-2'));
    await new Promise((res) => setTimeout(res, 50));
    expect(r1.docBytes('wipe-1')).toBeGreaterThan(0);

    await r1.wipeAll();
    const left = (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith('mapops'));
    expect(left).toEqual([]);

    const r2 = new Repo();
    await r2.init();
    expect(r2.getSnapshot()).toEqual([]);
    expect(r2.getMap('wipe-1')).toBeUndefined();
  });
});

describe('Repo (IndexedDB)', () => {
  it('저장 후 새 인스턴스로 다시 열어도 남아 있고, 삭제하면 사라진다', async () => {
    const r1 = new Repo();
    await r1.init();
    await r1.createMap(sample('persist-1'));
    r1.saveMap({ ...sample('persist-1'), name: '은행(수정)' });
    expect(r1.getSnapshot().map((m) => m.name)).toContain('은행(수정)');

    // IndexedDB 기록은 비동기라 잠시 기다린다
    await new Promise((res) => setTimeout(res, 50));
    const r2 = new Repo();
    await r2.init();
    const loaded = r2.getMap('persist-1');
    expect(loaded?.name).toBe('은행(수정)');
    expect(loaded?.markers).toHaveLength(2);

    await r2.deleteMap('persist-1');
    expect(r2.getMap('persist-1')).toBeUndefined();
    await new Promise((res) => setTimeout(res, 50));
    const r3 = new Repo();
    await r3.init();
    expect(r3.getMap('persist-1')).toBeUndefined();
  });
});
