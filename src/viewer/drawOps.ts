/** 층별 낙서 연산. 좌표는 모두 그 층 이미지 픽셀(로컬) 단위. 순수 함수. */
import type { Vec } from '../geometry';
import type { GameMap, Id, Stroke } from '../model';

export const PEN_COLORS = ['#ff4d4f', '#ffd43b', '#51cf66', '#4dabf7', '#ffffff', '#212529'];
/** 화면 기준 펜 굵기(px). 저장 시 현재 배율로 나눠 층 픽셀 단위로 바꾼다. */
export const PEN_WIDTHS = [2, 4, 8, 14];

/** 직전 점과 minDist보다 가까운 점은 버린다(저장량·전송량 절감). 마지막 점은 항상 남긴다. */
export function simplify(points: Vec[], minDist: number): Vec[] {
  if (points.length <= 2) return points.slice();
  const out: Vec[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

export const flatten = (pts: Vec[]): number[] => pts.flatMap((p) => [round2(p.x), round2(p.y)]);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function strokesOnFloor(map: GameMap, floorId: Id): Stroke[] {
  return (map.strokes ?? []).filter((s) => s.floorId === floorId);
}

export function addStroke(map: GameMap, stroke: Stroke): GameMap {
  return { ...map, strokes: [...(map.strokes ?? []), stroke] };
}

export function deleteStroke(map: GameMap, id: Id): GameMap {
  return { ...map, strokes: (map.strokes ?? []).filter((s) => s.id !== id) };
}

export function clearFloorStrokes(map: GameMap, floorId: Id): GameMap {
  return { ...map, strokes: (map.strokes ?? []).filter((s) => s.floorId !== floorId) };
}

function distToSegment(p: Vec, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}

/** 지우개: 점 p에서 tol(+획 굵기 절반) 안에 있는 가장 위(나중) 획의 ID. */
export function hitStroke(strokes: Stroke[], p: Vec, tol: number): Id | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]!;
    const pts = s.points;
    const reach = tol + s.width / 2;
    if (pts.length === 2 && Math.hypot(p.x - pts[0]!, p.y - pts[1]!) <= reach) return s.id;
    for (let j = 0; j + 3 < pts.length; j += 2) {
      if (distToSegment(p, pts[j]!, pts[j + 1]!, pts[j + 2]!, pts[j + 3]!) <= reach) return s.id;
    }
  }
  return null;
}

/** SVG path 문자열(점 하나면 아주 짧은 선으로 찍힌 점처럼 보이게). */
export function strokePath(points: number[]): string {
  if (points.length < 2) return '';
  let d = `M${points[0]} ${points[1]}`;
  if (points.length === 2) return `${d}L${points[0]! + 0.01} ${points[1]}`;
  for (let i = 2; i + 1 < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`;
  return d;
}
