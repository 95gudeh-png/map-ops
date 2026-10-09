import { describe, expect, it } from 'vitest';
import { vec } from '../geometry';
import { changeAnchor, mergeEditedMap, removeFloor, replaceFloorImage } from '../mapOps';
import type { GameMap, Stroke } from '../model';
import {
  addStroke,
  arrowHeadPath,
  clearFloorStrokes,
  dashArray,
  DEFAULT_PEN,
  deleteStroke,
  flatten,
  hitStroke,
  isThrough,
  normalizePen,
  simplify,
  strokeOnFloor,
  strokePath,
  strokeStyleOf,
  strokesOnFloor,
  throughFloors,
} from './drawOps';

const stroke = (id: string, floorId: string, points: number[], width = 4): Stroke => ({ id, floorId, color: '#fff', width, points, createdAt: 0 });

const map = (): GameMap => ({
  id: 'm',
  name: 'x',
  anchorFloorId: 'A',
  floors: [
    { id: 'A', name: '1층', imageId: 'a', imageW: 1000, imageH: 800, sim: { r: 1, d: vec(0, 0) }, r0: 1 },
    { id: 'B', name: '2층', imageId: 'b', imageW: 2000, imageH: 1600, sim: { r: 0.5, d: vec(0, 0) }, r0: 0.5 },
  ],
  markers: [],
  strokes: [stroke('s1', 'A', [0, 0, 100, 0]), stroke('s2', 'B', [10, 10, 20, 20])],
  updatedAt: 0,
});

describe('drawOps', () => {
  it('simplify는 가까운 점을 버리고 끝점은 남긴다', () => {
    const pts = [vec(0, 0), vec(0.5, 0), vec(1, 0), vec(3, 0), vec(3.2, 0)];
    expect(simplify(pts, 2)).toEqual([vec(0, 0), vec(3, 0), vec(3.2, 0)]);
    expect(flatten([vec(1.234, 5.678)])).toEqual([1.23, 5.68]);
  });

  it('층별로 분리된다', () => {
    expect(strokesOnFloor(map(), 'A').map((s) => s.id)).toEqual(['s1']);
    expect(strokesOnFloor(map(), 'B').map((s) => s.id)).toEqual(['s2']);
  });

  it('추가·삭제·층 전체 지우기', () => {
    let m = addStroke(map(), stroke('s3', 'A', [1, 1]));
    expect(strokesOnFloor(m, 'A')).toHaveLength(2);
    m = deleteStroke(m, 's1');
    expect(strokesOnFloor(m, 'A').map((s) => s.id)).toEqual(['s3']);
    m = clearFloorStrokes(m, 'A');
    expect(strokesOnFloor(m, 'A')).toHaveLength(0);
    expect(strokesOnFloor(m, 'B')).toHaveLength(1);
  });

  it('지우개 판정: 선분 근처면 맞고, 멀면 빗나간다. 겹치면 나중 획', () => {
    const ss = [stroke('a', 'A', [0, 0, 100, 0]), stroke('b', 'A', [50, -10, 50, 10])];
    expect(hitStroke(ss, vec(50, 1), 2)).toBe('b');
    expect(hitStroke(ss, vec(20, 3), 2)).toBe('a');
    expect(hitStroke(ss, vec(20, 20), 2)).toBeNull();
    expect(hitStroke([stroke('dot', 'A', [5, 5])], vec(6, 5), 0)).toBe('dot');
  });

  it('펜 설정 정규화: 이전 형식(색·굵기만)도 기본값을 채운다', () => {
    expect(normalizePen({ color: '#123456', width: 8 })).toEqual({ color: '#123456', width: 8, opacity: 1, dash: 'solid', arrow: false });
    expect(normalizePen({ color: 'red', width: 999, opacity: 0, dash: 'x' })).toEqual({ ...DEFAULT_PEN, width: 30, opacity: 0.1 });
    expect(normalizePen(null)).toEqual(DEFAULT_PEN);
  });

  it('획 속성은 기본값이면 생략', () => {
    expect(strokeStyleOf(DEFAULT_PEN)).toEqual({});
    expect(strokeStyleOf({ ...DEFAULT_PEN, opacity: 0.4, dash: 'dot', arrow: true })).toEqual({ opacity: 0.4, dash: 'dot', arrow: true });
  });

  it('점선·파선은 굵기에 비례', () => {
    expect(dashArray('dash', 2)).toBe('6 4');
    expect(dashArray('dot', 2)).toBe('0.01 4');
    expect(dashArray(undefined, 2)).toBeUndefined();
  });

  it('화살촉은 끝 방향을 향하고, 너무 짧으면 없다', () => {
    const d = arrowHeadPath([0, 0, 100, 0], 2); // 오른쪽으로
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(nums[0]).toBeGreaterThan(100); // 촉 끝이 선 끝보다 앞
    expect(nums[2]).toBeLessThan(100); // 날개는 뒤쪽
    expect(nums[3]).toBeCloseTo(-nums[5]!); // 위아래 대칭
    expect(arrowHeadPath([5, 5], 2)).toBe('');
    expect(arrowHeadPath([5, 5, 5, 5], 2)).toBe('');
  });

  it('SVG path', () => {
    expect(strokePath([0, 0, 10, 5])).toBe('M0 0L10 5');
    expect(strokePath([3, 4])).toBe('M3 4L3.01 4');
  });
});

describe('낙서와 맵 연산', () => {
  it('층을 지우면 그 층 낙서도 지워진다', () => {
    const m = removeFloor(map(), 'B').map;
    expect(m.strokes!.map((s) => s.id)).toEqual(['s1']);
  });

  it('이미지를 다른 해상도로 바꿔도 낙서의 월드 위치·굵기가 같다', () => {
    const before = map();
    const after = replaceFloorImage(before, 'B', { imageId: 'b2', w: 1000, h: 800 }).map;
    const s = after.strokes!.find((x) => x.id === 's2')!;
    const f = after.floors.find((x) => x.id === 'B')!;
    // 원래 월드: 0.5 × (10,10) = (5,5), 굵기 0.5 × 4 = 2
    expect(f.sim.r * s.points[0]!).toBeCloseTo(5);
    expect(f.sim.r * s.width).toBeCloseTo(2);
  });

  it('편집 중 친구가 그린 획은 저장 후에도 남는다', () => {
    const initial = map();
    const draft = { ...initial, name: '수정' };
    const current = addStroke(initial, stroke('friend', 'A', [1, 2, 3, 4]));
    const merged = mergeEditedMap(initial, draft, current);
    expect(merged.strokes!.map((s) => s.id)).toEqual(['s1', 's2', 'friend']);
  });
});

describe('관통 획', () => {
  const through = (id: string, floorIds: string[], points = [10, 10, 50, 50]): Stroke => ({
    id, floorId: floorIds[0]!, floorIds, color: '#ff0000', width: 4, points, createdAt: 1,
  });

  it('고른 층 모두에 보이고, 다른 층에는 안 보인다', () => {
    const m = { ...map(), strokes: [through('t', ['A', 'B'])] };
    expect(strokesOnFloor(m, 'A').map((s) => s.id)).toEqual(['t']);
    expect(strokesOnFloor(m, 'B').map((s) => s.id)).toEqual(['t']);
    expect(isThrough(m.strokes[0]!)).toBe(true);
    expect(strokeOnFloor(stroke('x', 'A', [0, 0]), 'B')).toBe(false);
  });

  it('대상 층: 고른 층 + 지금 층, 맵 순서. 하나뿐이면 단일층', () => {
    expect(throughFloors(map(), ['B'], 'A')).toEqual(['A', 'B']);
    expect(throughFloors(map(), ['A', 'B'], 'B')).toEqual(['A', 'B']);
    expect(throughFloors(map(), [], 'A')).toBeNull();
    expect(throughFloors(map(), ['없는층'], 'A')).toBeNull();
  });

  it('이 층 낙서 지우기: 관통 획은 이 층에서만 빠진다', () => {
    const m = { ...map(), strokes: [through('t', ['A', 'B']), through('only', ['A'])] };
    const r = clearFloorStrokes(m, 'A');
    expect(r.strokes!.map((s) => [s.id, s.floorIds])).toEqual([['t', ['B']]]);
    expect(strokesOnFloor(r, 'A')).toHaveLength(0);
  });

  it('기준층을 바꿔도 관통 획의 화면 위치·굵기가 유지된다', () => {
    const m = { ...map(), strokes: [through('t', ['A', 'B'], [100, 40])] };
    const view = { z: 1, pan: vec(0, 0) };
    const r = changeAnchor(m, 'B', view); // B: r=0.5, d=(0,0)
    const s = r.map.strokes![0]!;
    // 화면 = z'·w' + pan' 이 원래 화면(100,40)과 같아야 한다
    expect(r.view!.z * s.points[0]! + r.view!.pan.x).toBeCloseTo(100);
    expect(r.view!.z * s.points[1]! + r.view!.pan.y).toBeCloseTo(40);
    expect(r.view!.z * s.width).toBeCloseTo(4);
  });

  it('층을 지우면 관통 획에서 그 층만 빠지고, 이미지를 바꿔도 관통 획은 그대로', () => {
    const m = { ...map(), floors: [...map().floors, { ...map().floors[0]!, id: 'C', name: '3층', imageId: 'c' }], strokes: [through('t', ['A', 'B', 'C'])] };
    const removed = removeFloor(m, 'C').map;
    expect(removed.strokes![0]!.floorIds).toEqual(['A', 'B']);
    const replaced = replaceFloorImage(m, 'B', { imageId: 'b2', w: 1000, h: 800 }).map; // 기준층이 아닌 층
    expect(replaced.strokes![0]!.points).toEqual([10, 10, 50, 50]);
  });
});
