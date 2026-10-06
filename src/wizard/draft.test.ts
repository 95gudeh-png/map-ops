import { describe, expect, it } from 'vitest';
import { localToWorld, vec } from '../geometry';
import { addFloor, baseName, calibTargets, deleteFloor, emptyDraft, moveFloor, resetFloorPlacement, setAnchor } from './draft';

const img = (id: string, w: number, h: number) => ({ id, w, h });

describe('마법사 초안', () => {
  it('파일명에서 확장자를 뺀다', () => {
    expect(baseName('B1_지하.png')).toBe('B1_지하');
    expect(baseName('.png')).toBe('.png');
    expect(baseName('a.b.jpg')).toBe('a.b');
  });

  it('첫 층은 기준층(항등), 다음 층은 기준층 폭·중심에 맞춘다', () => {
    let d = addFloor(emptyDraft(), img('a', 1000, 800), '1층');
    d = addFloor(d, img('b', 2000, 1600), '2층');
    const [f1, f2] = d.floors;
    expect(d.anchorFloorId).toBe(f1!.id);
    expect(f1!.sim).toEqual({ r: 1, d: vec(0, 0) });
    expect(f2!.sim.r).toBeCloseTo(0.5);
    expect(f2!.r0).toBeCloseTo(0.5);
    const c = localToWorld(f2!.sim, vec(1000, 800));
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(400);
  });

  it('빈 초안 시작 시 플레이스홀더 층이 없다 (v1 결함 6)', () => {
    expect(emptyDraft().floors).toHaveLength(0);
  });

  it('마지막 층을 지우면 빈 초안이 된다', () => {
    const d = addFloor(emptyDraft(), img('a', 10, 10), 'x');
    const r = deleteFloor(d, d.floors[0]!.id);
    expect(r.draft.floors).toHaveLength(0);
    expect(r.draft.anchorFloorId).toBe('');
  });

  it('순서 변경', () => {
    let d = emptyDraft();
    for (const n of ['a', 'b', 'c']) d = addFloor(d, img(n, 10, 10), n);
    expect(moveFloor(d, 0, 2).floors.map((f) => f.name)).toEqual(['b', 'c', 'a']);
    expect(moveFloor(d, 2, 0).floors.map((f) => f.name)).toEqual(['c', 'a', 'b']);
    expect(moveFloor(d, 5, 0)).toBe(d);
  });

  it('기준층 변경 후 정렬 대상은 새 기준층을 제외한다', () => {
    let d = emptyDraft();
    for (const n of ['a', 'b', 'c']) d = addFloor(d, img(n, 100, 100), n);
    d = setAnchor(d, d.floors[1]!.id);
    expect(calibTargets(d).map((f) => f.name)).toEqual(['a', 'c']);
    expect(d.floors[1]!.sim.r).toBeCloseTo(1);
  });

  it('위치 초기화는 기준층과 겹친 상태로', () => {
    let d = addFloor(emptyDraft(), img('a', 1000, 500), 'a');
    d = addFloor(d, img('b', 500, 250), 'b');
    const id = d.floors[1]!.id;
    const moved = { ...d, floors: d.floors.map((f) => (f.id === id ? { ...f, sim: { r: 9, d: vec(5, 5) } } : f)) };
    expect(resetFloorPlacement(moved, id).floors[1]!.sim).toEqual(d.floors[1]!.sim);
  });
});
