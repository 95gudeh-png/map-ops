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
