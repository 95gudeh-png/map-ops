import { describe, expect, it } from 'vitest';
import { vec } from '../geometry';
import { mergeEditedMap, removeFloor, replaceFloorImage } from '../mapOps';
import type { GameMap, Stroke } from '../model';
import { addStroke, clearFloorStrokes, deleteStroke, flatten, hitStroke, simplify, strokePath, strokesOnFloor } from './drawOps';

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
