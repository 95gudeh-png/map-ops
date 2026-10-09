/** 층별 낙서 연산. 좌표는 모두 그 층 이미지 픽셀(로컬) 단위. 순수 함수. */
import type { Vec } from '../geometry';
import type { GameMap, Id, Stroke } from '../model';

export const PEN_COLORS = [
  '#ff4d4f', '#ff922b', '#ffd43b', '#94d82d', '#51cf66', '#20c997',
  '#22b8cf', '#4dabf7', '#5c7cfa', '#cc5de8', '#f783ac', '#ffffff',
  '#adb5bd', '#495057', '#212529',
];
/** 빠른 선택용 굵기(화면 px). 저장 시 현재 배율로 나눠 층 픽셀 단위로 바꾼다. */
export const PEN_WIDTHS = [2, 4, 8, 14];
export const PEN_WIDTH_MIN = 1;
export const PEN_WIDTH_MAX = 30;

export type DashStyle = 'solid' | 'dash' | 'dot';

/** 펜 설정(기기별). 굵기는 화면 px. */
export interface PenSettings {
  color: string;
  width: number;
  opacity: number;
  dash: DashStyle;
  arrow: boolean;
}

export interface PenPreset extends PenSettings {
  id: string;
  name: string;
}

export const DEFAULT_PEN: PenSettings = { color: '#ff4d4f', width: 4, opacity: 1, dash: 'solid', arrow: false };

export const DEFAULT_PRESETS: PenPreset[] = [
  { id: 'red', name: '빨강 펜', color: '#ff4d4f', width: 4, opacity: 1, dash: 'solid', arrow: false },
  { id: 'hl', name: '형광펜', color: '#ffd43b', width: 16, opacity: 0.35, dash: 'solid', arrow: false },
  { id: 'arrow', name: '파란 화살표', color: '#4dabf7', width: 4, opacity: 1, dash: 'solid', arrow: true },
  { id: 'dot', name: '흰 점선', color: '#ffffff', width: 3, opacity: 0.9, dash: 'dot', arrow: false },
];

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** 저장된 값(이전 형식 포함)을 안전한 펜 설정으로. */
export function normalizePen(v: unknown): PenSettings {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<PenSettings>;
  return {
    color: isHex(o.color) ? o.color : DEFAULT_PEN.color,
    width: num(o.width, PEN_WIDTH_MIN, PEN_WIDTH_MAX, DEFAULT_PEN.width),
    opacity: num(o.opacity, 0.1, 1, 1),
    dash: o.dash === 'dash' || o.dash === 'dot' ? o.dash : 'solid',
    arrow: o.arrow === true,
  };
}

/** 펜 설정 → 저장할 획 속성(기본값은 생략해 데이터를 줄인다). */
export function strokeStyleOf(pen: PenSettings): Pick<Stroke, 'opacity' | 'dash' | 'arrow'> {
  return {
    ...(pen.opacity < 1 ? { opacity: pen.opacity } : {}),
    ...(pen.dash !== 'solid' ? { dash: pen.dash } : {}),
    ...(pen.arrow ? { arrow: true } : {}),
  };
}

/** SVG stroke-dasharray(굵기에 비례). 실선이면 undefined. */
export function dashArray(dash: DashStyle | undefined, width: number): string | undefined {
  if (dash === 'dash') return `${width * 3} ${width * 2}`;
  if (dash === 'dot') return `0.01 ${width * 2}`; // 둥근 끝(cap)과 함께 점으로 보인다
  return undefined;
}

/**
 * 획 끝의 화살촉(채운 삼각형) 경로. 방향은 끝에서 굵기의 3배 이상 떨어진 점까지로 정해 손떨림에 덜 흔들린다.
 * 점이 하나뿐이거나 너무 짧으면 빈 문자열.
 */
export function arrowHeadPath(points: number[], width: number): string {
  const n = points.length / 2;
  if (n < 2) return '';
  const ex = points[(n - 1) * 2]!, ey = points[(n - 1) * 2 + 1]!;
  const need = width * 3;
  let bx = ex, by = ey;
  for (let i = n - 2; i >= 0; i--) {
    bx = points[i * 2]!;
    by = points[i * 2 + 1]!;
    if (Math.hypot(ex - bx, ey - by) >= need) break;
  }
  const len = Math.hypot(ex - bx, ey - by);
  if (len < 1e-6) return '';
  const ux = (ex - bx) / len, uy = (ey - by) / len;
  const L = Math.max(width * 3.5, 4), H = L * 0.6;
  // 촉 끝을 선 끝보다 조금 앞에 두어 둥근 끝(cap)이 삐져나오지 않게
  const tx = ex + ux * width * 0.6, ty = ey + uy * width * 0.6;
  const cx = tx - ux * L, cy = ty - uy * L;
  const r = (v: number) => Math.round(v * 100) / 100;
  return `M${r(tx)} ${r(ty)}L${r(cx - uy * H)} ${r(cy + ux * H)}L${r(cx + uy * H)} ${r(cy - ux * H)}Z`;
}

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

/** 관통 획인지(좌표가 월드 단위). */
export const isThrough = (s: Stroke): s is Stroke & { floorIds: Id[] } => Array.isArray(s.floorIds);

/** 이 층에 보이는 획인지(단일층은 그 층, 관통은 floorIds에 포함). */
export const strokeOnFloor = (s: Stroke, floorId: Id) => (isThrough(s) ? s.floorIds.includes(floorId) : s.floorId === floorId);

export function strokesOnFloor(map: GameMap, floorId: Id): Stroke[] {
  return (map.strokes ?? []).filter((s) => strokeOnFloor(s, floorId));
}

/** 관통 그리기의 대상 층: 고른 층 + 지금 그리는 층, 맵의 층 순서대로. 하나뿐이면 null(단일층으로 그림). */
export function throughFloors(map: GameMap, selected: Id[], current: Id): Id[] | null {
  const ids = map.floors.map((f) => f.id).filter((id) => id === current || selected.includes(id));
  return ids.length > 1 ? ids : null;
}

export function addStroke(map: GameMap, stroke: Stroke): GameMap {
  return { ...map, strokes: [...(map.strokes ?? []), stroke] };
}

export function deleteStroke(map: GameMap, id: Id): GameMap {
  return { ...map, strokes: (map.strokes ?? []).filter((s) => s.id !== id) };
}

/** 이 층의 낙서를 지운다. 관통 획은 이 층에서만 빠지고 다른 층에는 남는다. */
export function clearFloorStrokes(map: GameMap, floorId: Id): GameMap {
  const strokes: Stroke[] = [];
  for (const s of map.strokes ?? []) {
    if (!isThrough(s)) {
      if (s.floorId !== floorId) strokes.push(s);
      continue;
    }
    if (!s.floorIds.includes(floorId)) {
      strokes.push(s);
      continue;
    }
    const rest = s.floorIds.filter((id) => id !== floorId);
    if (rest.length) strokes.push({ ...s, floorIds: rest });
  }
  return { ...map, strokes };
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
