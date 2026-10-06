/** 십자선 설정(기기별 로컬 저장, 명세서 §4.2). */
export interface CrosshairSettings {
  length: number;
  thickness: number;
  color: string;
}

export const DEFAULT_CROSSHAIR: CrosshairSettings = { length: 22, thickness: 2, color: '#3ea6ff' };
const KEY = 'mapops.crosshair';

export function loadCrosshair(): CrosshairSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CROSSHAIR;
    const v = JSON.parse(raw) as Partial<CrosshairSettings>;
    return {
      length: clampNum(v.length, 10, 50, DEFAULT_CROSSHAIR.length),
      thickness: clampNum(v.thickness, 1, 6, DEFAULT_CROSSHAIR.thickness),
      color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : DEFAULT_CROSSHAIR.color,
    };
  } catch {
    return DEFAULT_CROSSHAIR;
  }
}

export function saveCrosshair(s: CrosshairSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 불가(사생활 보호 모드 등) — 무시 */
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/* ---------- 커서 가이드 ---------- */

export type ReticleShape = 'cross' | 'dot' | 'circle' | 'crossDot' | 'none';
export const RETICLE_SHAPES: ReticleShape[] = ['cross', 'dot', 'circle', 'crossDot', 'none'];

/** 커서를 따라다니는 가이드(기기별). 같은 월드 좌표가 모든 패널에 동시에 표시된다. */
export interface CursorGuideSettings {
  enabled: boolean;
  /** 패널 끝까지 이어지는 가로·세로 선. */
  lines: boolean;
  lineColor: string;
  lineOpacity: number;
  lineWidth: number;
  reticle: ReticleShape;
  reticleSize: number;
  reticleColor: string;
  reticleThickness: number;
  /** 십자 가운데 빈틈(px). */
  gap: number;
  /** 기본 마우스 화살표를 숨긴다(중앙 표시가 있을 때). */
  hideCursor: boolean;
}

export const DEFAULT_CURSOR_GUIDE: CursorGuideSettings = {
  enabled: true,
  lines: true,
  lineColor: '#ffffff',
  lineOpacity: 0.35,
  lineWidth: 1,
  reticle: 'cross',
  reticleSize: 18,
  reticleColor: '#3ea6ff',
  reticleThickness: 2,
  gap: 4,
  hideCursor: true,
};
const GUIDE_KEY = 'mapops.cursorGuide';

export function loadCursorGuide(): CursorGuideSettings {
  const d = DEFAULT_CURSOR_GUIDE;
  try {
    const raw = localStorage.getItem(GUIDE_KEY);
    if (!raw) return d;
    const v = JSON.parse(raw) as Partial<CursorGuideSettings>;
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
      lines: typeof v.lines === 'boolean' ? v.lines : d.lines,
      lineColor: isHex(v.lineColor) ? v.lineColor : d.lineColor,
      lineOpacity: clampNum(v.lineOpacity, 0.1, 1, d.lineOpacity),
      lineWidth: clampNum(v.lineWidth, 1, 4, d.lineWidth),
      reticle: RETICLE_SHAPES.includes(v.reticle as ReticleShape) ? (v.reticle as ReticleShape) : d.reticle,
      reticleSize: clampNum(v.reticleSize, 6, 48, d.reticleSize),
      reticleColor: isHex(v.reticleColor) ? v.reticleColor : d.reticleColor,
      reticleThickness: clampNum(v.reticleThickness, 1, 5, d.reticleThickness),
      gap: clampNum(v.gap, 0, 16, d.gap),
      hideCursor: typeof v.hideCursor === 'boolean' ? v.hideCursor : d.hideCursor,
    };
  } catch {
    return d;
  }
}

export function saveCursorGuide(s: CursorGuideSettings) {
  try {
    localStorage.setItem(GUIDE_KEY, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}
