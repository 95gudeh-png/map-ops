import { describe, expect, it } from 'vitest';
import { localToWorld, vec } from '../geometry';
import { markerWorld } from '../mapOps';
import type { GameMap } from '../model';
import { addMarker, deleteMarker, moveMarker, throughFloorsLabel, updateMarker } from './markerOps';

const map = (): GameMap => ({
  id: 'm',
  name: 'x',
  anchorFloorId: 'A',
  floors: [
    { id: 'B', name: '지하', imageId: 'b', imageW: 100, imageH: 100, sim: { r: 2, d: vec(10, 20) }, r0: 2 },
    { id: 'A', name: '1층', imageId: 'a', imageW: 100, imageH: 100, sim: { r: 1, d: vec(0, 0) }, r0: 1 },
    { id: 'C', name: '2층', imageId: 'c', imageW: 100, imageH: 100, sim: { r: 0.5, d: vec(-5, 5) }, r0: 0.5 },
  ],
  markers: [],
  updatedAt: 0,
});

const w = vec(40, 60);
const base = { type: 'camera' as const, label: ' 카메라 ', w, originFloorId: 'B', through: false, floorIds: [] };

describe('markerOps', () => {
  it('단일층 마커는 그 층 로컬 좌표로 저장되고 월드 위치는 클릭한 곳', () => {
    const { map: m, marker } = addMarker(map(), base, 'k', 1);
    expect(marker.label).toBe('카메라');
    expect(marker.scope.kind).toBe('floor');
    expect(markerWorld(m, marker)).toEqual(w);
    if (marker.scope.kind === 'floor') expect(localToWorld(m.floors[0]!.sim, marker.scope.p)).toEqual(w);
  });

  it('관통 마커는 월드 좌표, 층은 맵 순서로 정렬되고 출발 층이 항상 포함된다', () => {
    const { map: m, marker } = addMarker(map(), { ...base, through: true, originFloorId: 'C', floorIds: ['B'] });
    expect(marker.scope).toEqual({ kind: 'through', floorIds: ['B', 'C'], w });
    expect(throughFloorsLabel(m, marker)).toBe('지하·2층');
  });

  it('관통인데 층이 하나뿐이면 단일층 마커가 된다', () => {
    const { marker } = addMarker(map(), { ...base, through: true, floorIds: [] });
    expect(marker.scope.kind).toBe('floor');
  });

  it('층간연결은 관통을 끄더라도 관통이다', () => {
    const { marker } = addMarker(map(), { ...base, type: 'connector', through: false });
    expect(marker.scope.kind).toBe('through');
  });

  it('이동: 단일층은 로컬 환산, 관통은 월드 그대로', () => {
    let m = addMarker(map(), base, 'k1').map;
    m = addMarker(m, { ...base, through: true, floorIds: ['A'] }, 'k2').map;
    const to = vec(1, 2);
    m = moveMarker(moveMarker(m, 'k1', to), 'k2', to);
    expect(markerWorld(m, m.markers[0]!)).toEqual(to);
    expect(markerWorld(m, m.markers[1]!)).toEqual(to);
  });

  it('수정: 유형·이름·범위를 바꿔도 위치는 유지', () => {
    let m = addMarker(map(), base, 'k').map;
    m = updateMarker(m, 'k', { ...base, w, type: 'note', label: '메모', through: true, floorIds: ['A', 'C'] });
    const mk = m.markers[0]!;
    expect(mk.type).toBe('note');
    expect(mk.scope.kind).toBe('through');
    expect(markerWorld(m, mk)).toEqual(w);
  });

  it('삭제', () => {
    const m = addMarker(map(), base, 'k').map;
    expect(deleteMarker(m, 'k').markers).toHaveLength(0);
  });
});
