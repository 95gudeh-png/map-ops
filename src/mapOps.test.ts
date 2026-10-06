import { describe, expect, it } from 'vitest';
import { localToWorld, vec, worldToScreen, type View } from './geometry';
import { changeAnchor, markerWorld, mergeEditedMap, removeFloor, replaceFloorImage } from './mapOps';
import type { Floor, GameMap, Marker } from './model';

function floor(id: string, r: number, dx: number, dy: number, w = 1000, h = 800): Floor {
  return { id, name: id, imageId: `img-${id}`, imageW: w, imageH: h, sim: { r, d: vec(dx, dy) }, r0: r };
}

function sampleMap(): GameMap {
  const markers: Marker[] = [
    { id: 'm1', type: 'camera', label: '1층 카메라', scope: { kind: 'floor', floorId: 'F1', p: vec(100, 200) }, createdAt: 1 },
    { id: 'm2', type: 'note', label: '2층 메모', scope: { kind: 'floor', floorId: 'F2', p: vec(500, 400) }, createdAt: 2 },
    { id: 'm3', type: 'connector', label: '해치', scope: { kind: 'through', floorIds: ['F1', 'F2', 'F3'], w: vec(300, 300) }, createdAt: 3 },
    { id: 'm4', type: 'objective', label: '계단', scope: { kind: 'through', floorIds: ['F2', 'F3'], w: vec(700, 100) }, createdAt: 4 },
  ];
  return {
    id: 'map',
    name: '은행',
    anchorFloorId: 'F1',
    floors: [floor('F1', 1, 0, 0), floor('F2', 1.3, -40, 25, 900, 700), floor('F3', 0.7, 120, -60, 2000, 1600)],
    markers,
    updatedAt: 0,
  };
}

const screenOf = (map: GameMap, view: View, id: string) => {
  const m = map.markers.find((x) => x.id === id)!;
  return worldToScreen(view, markerWorld(map, m)!);
};

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('changeAnchor', () => {
  it('모든 마커와 층의 화면 위치를 유지하고 새 기준층을 항등으로 만든다', () => {
    const map = sampleMap();
    const view: View = { z: 0.6, pan: vec(30, 40) };
    const { map: m2, view: v2 } = changeAnchor(map, 'F3', view);

    expect(m2.anchorFloorId).toBe('F3');
    const f3 = m2.floors.find((f) => f.id === 'F3')!;
    expect(f3.sim.r).toBeCloseTo(1);
    close(f3.sim.d, vec(0, 0));

    for (const id of ['m1', 'm2', 'm3', 'm4']) close(screenOf(m2, v2!, id), screenOf(map, view, id));
    for (const f of map.floors) {
      const f2 = m2.floors.find((x) => x.id === f.id)!;
      const p = vec(123, 456);
      close(worldToScreen(v2!, localToWorld(f2.sim, p)), worldToScreen(view, localToWorld(f.sim, p)));
      expect(f2.sim.r / f2.r0).toBeCloseTo(f.sim.r / f.r0); // clamp 허용 범위 유지
    }
  });

  it('단일층 마커의 로컬 좌표는 바뀌지 않는다', () => {
    const map = sampleMap();
    const { map: m2 } = changeAnchor(map, 'F2');
    expect(m2.markers.find((m) => m.id === 'm1')!.scope).toEqual(map.markers.find((m) => m.id === 'm1')!.scope);
  });
});

describe('removeFloor', () => {
  it('그 층 단일층 마커는 삭제, 관통 마커는 층만 빠진다', () => {
    const { map, removedMarkers } = removeFloor(sampleMap(), 'F2');
    expect(removedMarkers).toBe(1);
    expect(map.markers.map((m) => m.id).sort()).toEqual(['m1', 'm3', 'm4']);
    const m3 = map.markers.find((m) => m.id === 'm3')!;
    expect(m3.scope.kind === 'through' && m3.scope.floorIds).toEqual(['F1', 'F3']);
  });

  it('관통 마커에 층이 하나만 남으면 그 층의 단일층 마커로 바뀌고 위치는 유지된다', () => {
    const before = sampleMap();
    const { map } = removeFloor(before, 'F2');
    const m4 = map.markers.find((m) => m.id === 'm4')!;
    expect(m4.scope.kind).toBe('floor');
    close(markerWorld(map, m4)!, vec(700, 100));
  });

  it('층간연결 유형은 층이 하나 남아도 관통으로 유지된다', () => {
    let map = sampleMap();
    map = removeFloor(map, 'F2').map;
    map = removeFloor(map, 'F3').map;
    const m3 = map.markers.find((m) => m.id === 'm3')!;
    expect(m3.scope.kind).toBe('through');
  });

  it('기준층을 지우면 다른 층이 기준이 되고 남은 마커 화면 위치가 유지된다', () => {
    const before = sampleMap();
    const view: View = { z: 1, pan: vec(0, 0) };
    const { map } = removeFloor(before, 'F1');
    expect(map.anchorFloorId).not.toBe('F1');
    const anchor = map.floors.find((f) => f.id === map.anchorFloorId)!;
    expect(anchor.sim.r).toBeCloseTo(1);
    // 월드 좌표계가 바뀌었으므로 기준층 변경과 같은 뷰 보정을 거쳐 비교
    const { view: v2 } = changeAnchor(before, map.anchorFloorId, view);
    close(screenOf(map, v2!, 'm3'), screenOf(before, view, 'm3'));
    close(screenOf(map, v2!, 'm2'), screenOf(before, view, 'm2'));
  });

  it('마지막 층은 지울 수 없다', () => {
    let map = sampleMap();
    map = removeFloor(map, 'F2').map;
    map = removeFloor(map, 'F3').map;
    expect(() => removeFloor(map, 'F1')).toThrow();
  });
});

describe('mergeEditedMap', () => {
  it('편집 중 다른 사람이 추가한 마커는 남고, 편집으로 지운 마커와 남이 지운 마커는 빠진다', () => {
    const initial = sampleMap();
    // 편집: F3 삭제(m3에서 F3 빠짐, m4는 F2 단일로)
    const draft = removeFloor(initial, 'F3').map;
    // 그 사이 친구: m1 삭제, 새 마커 2개 추가(하나는 지워질 F3에만)
    const extra: Marker[] = [
      { id: 'n1', type: 'note', label: '친구', scope: { kind: 'floor', floorId: 'F2', p: vec(1, 1) }, createdAt: 9 },
      { id: 'n2', type: 'note', label: 'F3만', scope: { kind: 'floor', floorId: 'F3', p: vec(1, 1) }, createdAt: 10 },
    ];
    const current = { ...initial, markers: [...initial.markers.filter((m) => m.id !== 'm1'), ...extra] };
    const merged = mergeEditedMap(initial, draft, current);
    expect(merged.markers.map((m) => m.id)).toEqual(['m2', 'm3', 'm4', 'n1']);
    expect(merged.markers.find((m) => m.id === 'm4')!.scope.kind).toBe('floor');
  });
});

describe('replaceFloorImage', () => {
  it('종속층 이미지를 2배 해상도로 바꿔도 마커 위치가 같다', () => {
    const before = sampleMap();
    const { map, aspectWarning } = replaceFloorImage(before, 'F2', { imageId: 'new', w: 1800, h: 1400 });
    expect(aspectWarning).toBe(false);
    close(markerWorld(map, map.markers.find((m) => m.id === 'm2')!)!, markerWorld(before, before.markers[1]!)!);
  });

  it('기준층 이미지를 바꾸면 항등으로 재정규화되고 화면 위치는 유지된다', () => {
    const before = sampleMap();
    const { map } = replaceFloorImage(before, 'F1', { imageId: 'new', w: 500, h: 400 });
    const f1 = map.floors.find((f) => f.id === 'F1')!;
    expect(f1.sim.r).toBeCloseTo(1);
    // 월드 단위가 1/2로 바뀌었으므로 뷰 z=2에서 원래 z=1과 같아야 한다
    const vOld: View = { z: 1, pan: vec(0, 0) };
    const vNew: View = { z: 2, pan: vec(0, 0) };
    for (const id of ['m1', 'm2', 'm3', 'm4']) close(screenOf(map, vNew, id), screenOf(before, vOld, id));
  });

  it('비율이 다르면 경고한다', () => {
    const { aspectWarning } = replaceFloorImage(sampleMap(), 'F2', { imageId: 'new', w: 900, h: 900 });
    expect(aspectWarning).toBe(true);
  });
});
