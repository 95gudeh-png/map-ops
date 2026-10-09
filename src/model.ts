/** 데이터 모델 (명세서 §3.1, §3.2). */
import type { Sim, Vec } from './geometry';

export type Id = string;

export const newId = (): Id => crypto.randomUUID();

export interface Floor {
  id: Id;
  name: string;
  /** 이미지 Blob의 내용 해시. */
  imageId: string;
  imageW: number;
  imageH: number;
  /** 층 → 월드 변환. 기준층은 항등. */
  sim: Sim;
  /** 초기 배치 배율(배율 clamp 기준). */
  r0: number;
}

export type MarkerType = 'objective' | 'camera' | 'connector' | 'note';

export const MARKER_TYPES: Record<MarkerType, { label: string; color: string }> = {
  objective: { label: '목표', color: '#e0a83e' },
  camera: { label: '카메라', color: '#3ea6ff' },
  connector: { label: '층간연결', color: '#e0555a' },
  note: { label: '메모', color: '#8b96a5' },
};

/** 단일층 마커: 층 로컬 좌표. 그 층을 재보정하면 함께 움직인다. */
export interface FloorScope {
  kind: 'floor';
  floorId: Id;
  p: Vec;
}

/** 관통 마커: 월드 좌표. 여러 층에 같은 물리 위치로 표시된다. */
export interface ThroughScope {
  kind: 'through';
  floorIds: Id[];
  w: Vec;
}

export type MarkerScope = FloorScope | ThroughScope;

export interface Marker {
  id: Id;
  type: MarkerType;
  label: string;
  scope: MarkerScope;
  /** 목록 정렬용(ms). */
  createdAt: number;
}

/**
 * 낙서 한 획.
 * - 단일층(floorIds 없음): 좌표·굵기는 그 층 이미지 픽셀 단위(그 층을 재보정하면 함께 움직임).
 * - 관통(floorIds 있음): 좌표·굵기는 월드 단위이고, floorIds의 모든 층에 같은 물리 위치로 표시(관통 마커와 같은 규칙).
 */
export interface Stroke {
  id: Id;
  /** 그린 층(관통이면 처음 그린 층 — 기록용). */
  floorId: Id;
  /** 관통 획이 표시될 층들. 있으면 points·width가 월드 좌표. */
  floorIds?: Id[];
  color: string;
  /** 굵기(층 이미지 픽셀). */
  width: number;
  /** 평탄화한 좌표 [x0, y0, x1, y1, ...] (Yjs 저장량을 줄이려고 배열 하나로). */
  points: number[];
  createdAt: number;
  /** 불투명도(없으면 1). */
  opacity?: number;
  /** 선 모양(없으면 실선). */
  dash?: 'dash' | 'dot';
  /** 끝에 화살표. */
  arrow?: boolean;
}

export type MarkerOutline = 'dark' | 'light' | 'none';

/** 맵별 마커 표시 설정. */
export interface MarkerStyle {
  /** 크기 배율(1 = 기본 14px). */
  size: number;
  opacity: number;
  outline: MarkerOutline;
  /** 이름표 글자 크기(px). */
  labelSize: number;
  /** 유형별 색 덮어쓰기. */
  colors: Partial<Record<MarkerType, string>>;
}

export const DEFAULT_MARKER_STYLE: MarkerStyle = { size: 1, opacity: 1, outline: 'dark', labelSize: 11, colors: {} };

export const markerColor = (style: MarkerStyle | undefined, type: MarkerType) =>
  style?.colors[type] ?? MARKER_TYPES[type].color;

export interface GameMap {
  id: Id;
  name: string;
  anchorFloorId: Id;
  floors: Floor[];
  markers: Marker[];
  /** 층별 낙서(없으면 빈 배열로 취급 — 이전 버전 데이터 호환). */
  strokes?: Stroke[];
  /** 마커 표시 설정(없으면 기본값). */
  markerStyle?: MarkerStyle;
  updatedAt: number;
}
