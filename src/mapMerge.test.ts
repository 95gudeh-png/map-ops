import { describe, expect, it } from 'vitest';
import { vec } from './geometry';
import { findDuplicateGroups, mergeMaps } from './mapMerge';
import { markerWorld } from './mapOps';
import type { GameMap, Marker } from './model';

/** 같은 이미지(i1, i2)로 만든 맵. 층 ID와 정렬값은 맵마다 다를 수 있다. */
function build(id: string, floorPrefix: string, r2: number, extra: Partial<GameMap> = {}): GameMap {
  return {
    id,
    name: '은행',
    anchorFloorId: `${floorPrefix}1`,
    floors: [
      { id: `${floorPrefix}1`, name: '1층', imageId: 'i1', imageW: 100, imageH: 100, sim: { r: 1, d: vec(0, 0) }, r0: 1 },
      { id: `${floorPrefix}2`, name: '2층', imageId: 'i2', imageW: 200, imageH: 200, sim: { r: r2, d: vec(5, 5) }, r0: 0.5 },
    ],
    markers: [],
    strokes: [],
    updatedAt: 0,
    ...extra,
  };
}

const mk = (id: string, scope: Marker['scope'], label = id): Marker => ({ id, type: 'camera', label, scope, createdAt: 1 });

describe('중복 감지', () => {
  it('층 이미지 집합이 같으면 묶고, 다르면 따로', () => {
    const a = build('a', 'A', 0.5);
    const b = build('b', 'B', 0.5);
    const c = { ...build('c', 'C', 0.5), floors: [build('c', 'C', 0.5).floors[0]!] }; // 이미지 하나만
    const groups = findDuplicateGroups([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('합치기', () => {
  it('단일층 마커는 같은 이미지 층으로, 이미지 픽셀 그대로 옮긴다', () => {
    const target = build('t', 'T', 0.5);
    const source = build('s', 'S', 0.5, { markers: [mk('m1', { kind: 'floor', floorId: 'S2', p: vec(30, 40) })] });
    const r = mergeMaps(target, source);
    expect(r.markersAdded).toBe(1);
    expect(r.map.markers[0]!.scope).toEqual({ kind: 'floor', floorId: 'T2', p: vec(30, 40) });
  });

  it('관통 마커는 월드 좌표를 기준층 짝을 통해 환산한다', () => {
    const target = build('t', 'T', 0.5);
    const source = build('s', 'S', 0.5, { markers: [mk('m1', { kind: 'through', floorIds: ['S1', 'S2'], w: vec(12, 34) })] });
    const r = mergeMaps(target, source);
    const m = r.map.markers[0]!;
    expect(m.scope.kind).toBe('through');
    expect(markerWorld(r.map, m)).toEqual(vec(12, 34));
    if (m.scope.kind === 'through') expect(m.scope.floorIds).toEqual(['T1', 'T2']);
  });

  it('이미 같은 마커가 있으면 넣지 않는다', () => {
    const shared = (fid: string) => mk('x', { kind: 'floor', floorId: fid, p: vec(10, 10) }, '로비');
    const target = build('t', 'T', 0.5, { markers: [shared('T1')] });
    const source = build('s', 'S', 0.5, { markers: [{ ...shared('S1'), id: 'y' }] });
    const r = mergeMaps(target, source);
    expect(r.markersAdded).toBe(0);
    expect(r.map.markers).toHaveLength(1);
  });

  it('낙서도 층을 짝지어 옮기고 같은 획은 건너뛴다', () => {
    const stroke = (id: string, floorId: string) => ({ id, floorId, color: '#ffffff', width: 2, points: [0, 0, 5, 5], createdAt: 1 });
    const target = build('t', 'T', 0.5, { strokes: [stroke('t1', 'T1')] });
    const source = build('s', 'S', 0.5, { strokes: [stroke('s1', 'S1'), stroke('s2', 'S2')] });
    const r = mergeMaps(target, source);
    expect(r.strokesAdded).toBe(1);
    expect(r.map.strokes!.map((s) => s.floorId)).toEqual(['T1', 'T2']);
  });

  it('짝이 없는 층의 항목은 건너뛰고 개수를 알린다', () => {
    const target = { ...build('t', 'T', 0.5), floors: [build('t', 'T', 0.5).floors[0]!] };
    const source = build('s', 'S', 0.5, { markers: [mk('m', { kind: 'floor', floorId: 'S2', p: vec(1, 1) })] });
    const r = mergeMaps(target, source);
    expect(r.skipped).toBe(1);
    expect(r.map.markers).toHaveLength(0);
  });

  it('새로 넣은 항목은 새 ID를 받는다(원본 ID와 겹치지 않음)', () => {
    const target = build('t', 'T', 0.5);
    const source = build('s', 'S', 0.5, { markers: [mk('m1', { kind: 'floor', floorId: 'S1', p: vec(1, 1) })] });
    expect(mergeMaps(target, source).map.markers[0]!.id).not.toBe('m1');
  });
});
