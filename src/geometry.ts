/**
 * 좌표 변환 모듈 (명세서 §3).
 *
 * - 층 변환 Sim:  world = r·p + d      (p = 그 층 이미지 픽셀)
 * - 뷰 변환 View: screen = z·world + pan
 * - 월드 좌표 = 기준층 이미지 픽셀 좌표 (기준층은 항상 r=1, d=0)
 *
 * 모든 함수는 순수 함수이며 입력을 변경하지 않는다.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** 층 로컬(이미지 픽셀) → 월드 닮음변환. */
export interface Sim {
  r: number;
  d: Vec;
}

/** 월드 → 화면 뷰 변환. */
export interface View {
  z: number;
  pan: Vec;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const IDENTITY: Sim = { r: 1, d: { x: 0, y: 0 } };

export const vec = (x: number, y: number): Vec => ({ x, y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---------- 기본 변환 ---------- */

export const localToWorld = (s: Sim, p: Vec): Vec => add(mul(p, s.r), s.d);
export const worldToLocal = (s: Sim, w: Vec): Vec => mul(sub(w, s.d), 1 / s.r);

export const worldToScreen = (v: View, w: Vec): Vec => add(mul(w, v.z), v.pan);
export const screenToWorld = (v: View, s: Vec): Vec => mul(sub(s, v.pan), 1 / v.z);

/** 층 픽셀이 화면에서 차지하는 변환(이미지 요소의 CSS transform용). */
export const composeToScreen = (v: View, s: Sim): Sim => ({
  r: v.z * s.r,
  d: add(mul(s.d, v.z), v.pan),
});

/** 층 이미지가 월드에서 차지하는 사각형. */
export function floorWorldRect(s: Sim, size: Size): Rect {
  return { x: s.d.x, y: s.d.y, w: size.w * s.r, h: size.h * s.r };
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---------- 뷰 조작 (§3.6, §3.4의 3-0) ---------- */

/** 월드 사각형을 화면에 맞추는 뷰. padding은 배율 계수(0.92 = 8% 여백). */
export function fitView(content: Rect, stage: Size, padding = 0.92): View {
  const z = Math.min(stage.w / Math.max(content.w, 1e-9), stage.h / Math.max(content.h, 1e-9)) * padding;
  const center = vec(content.x + content.w / 2, content.y + content.h / 2);
  return { z, pan: sub(vec(stage.w / 2, stage.h / 2), mul(center, z)) };
}

/** 커서(화면 좌표) 아래 월드 점을 고정한 채 줌. z는 [minZ, maxZ]로 제한. */
export function zoomViewAt(v: View, cursor: Vec, factor: number, minZ: number, maxZ: number): View {
  const z = clamp(v.z * factor, minZ, maxZ);
  if (z === v.z) return v;
  return { z, pan: sub(cursor, mul(sub(cursor, v.pan), z / v.z)) };
}

export const panView = (v: View, deltaScreen: Vec): View => ({ z: v.z, pan: add(v.pan, deltaScreen) });

/* ---------- 정렬: 종속층 조작 (§3.4) ---------- */

/** 새 종속층의 초기 배치: 폭을 기준층에 맞추고 중심을 맞춘다. 반환값의 r이 r0. */
export function initialPlacement(anchor: Size, floor: Size): Sim {
  const r = anchor.w / floor.w;
  const cA = vec(anchor.w / 2, anchor.h / 2);
  const cI = vec(floor.w / 2, floor.h / 2);
  return { r, d: sub(cA, mul(cI, r)) };
}

/** 종속층 드래그: 화면 이동량 Δs → d += Δs / z. */
export const dragFloor = (s: Sim, deltaScreen: Vec, v: View): Sim => ({
  r: s.r,
  d: add(s.d, mul(deltaScreen, 1 / v.z)),
});

export const SCALE_STEP = 1.08;
export const SCALE_STEP_FINE = 1.01;
export const SCALE_RATIO_MIN = 0.3;
export const SCALE_RATIO_MAX = 3;

/**
 * 종속층 배율(Ctrl+휠): 커서 아래 월드 점을 고정한다.
 * r/r0 는 [SCALE_RATIO_MIN, SCALE_RATIO_MAX]로 제한.
 */
export function scaleFloorAt(s: Sim, cursorScreen: Vec, v: View, factor: number, r0: number): Sim {
  const r = clamp(s.r * factor, r0 * SCALE_RATIO_MIN, r0 * SCALE_RATIO_MAX);
  if (r === s.r) return s;
  const c = screenToWorld(v, cursorScreen);
  return { r, d: sub(c, mul(sub(c, s.d), r / s.r)) };
}

/* ---------- 기준층 변경 / 이미지 교체 (§3.5) ---------- */

export interface Reanchor {
  /** 층 변환을 새 기준 좌표로. */
  sim(s: Sim): Sim;
  /** 월드 점(관통 마커)을 새 기준 좌표로. */
  world(w: Vec): Vec;
  /** 화면이 그대로 보이도록 뷰를 보정. */
  view(v: View): View;
}

/** 현재 변환이 simB인 층을 새 기준층(항등)으로 삼는 좌표 변경. 단일층 마커는 변하지 않는다. */
export function reanchor(simB: Sim): Reanchor {
  const { r: rB, d: dB } = simB;
  return {
    sim: (s) => ({ r: s.r / rB, d: mul(sub(s.d, dB), 1 / rB) }),
    world: (w) => mul(sub(w, dB), 1 / rB),
    view: (v) => ({ z: v.z * rB, pan: add(v.pan, mul(dB, v.z)) }),
  };
}

export interface ImageReplace {
  sim: Sim;
  /** 그 층 단일층 마커의 로컬 좌표를 새 이미지 픽셀로. */
  local(p: Vec): Vec;
}

/** 층 이미지 교체(같은 내용, 다른 해상도). k = W_old / W_new. */
export function replaceImage(s: Sim, oldW: number, newW: number): ImageReplace {
  const k = oldW / newW;
  return {
    sim: { r: s.r * k, d: s.d },
    local: (p) => mul(p, 1 / k),
  };
}

/** 두 이미지의 가로세로 비율 차이가 tol(기본 1%)을 넘는지. */
export function aspectDiffers(a: Size, b: Size, tol = 0.01): boolean {
  const ra = a.w / a.h, rb = b.w / b.h;
  return Math.abs(ra - rb) / ra > tol;
}
