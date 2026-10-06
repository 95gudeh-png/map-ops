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
}

export interface GameMap {
  id: Id;
  name: string;
  anchorFloorId: Id;
  floors: Floor[];
  markers: Marker[];
  updatedAt: number;
}
