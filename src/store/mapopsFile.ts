/**
 * .mapops 파일(백업/이동용, 명세서 §4.5): 맵 JSON + 이미지(base64)를 한 파일에 담는다.
 * 순수 함수만 두어 테스트할 수 있게 하고, 저장소 연동은 exportImport.ts에서 한다.
 */
import type { Floor, GameMap, Marker, MarkerType } from '../model';

export const MAPOPS_FORMAT = 'mapops';
export const MAPOPS_VERSION = 1;

export interface MapopsImage {
  type: string;
  w: number;
  h: number;
  data: string; // base64
}

export interface MapopsFile {
  format: typeof MAPOPS_FORMAT;
  version: number;
  exportedAt: number;
  map: GameMap;
  images: Record<string, MapopsImage>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class FormatError extends Error {}
const fail = (msg: string): never => {
  throw new FormatError(`올바른 .mapops 파일이 아니오: ${msg}`);
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVec = (v: unknown) => isObj(v) && isNum(v.x) && isNum(v.y);
const MARKER_KINDS: MarkerType[] = ['objective', 'camera', 'connector', 'note'];

function checkFloor(f: unknown, i: number): Floor {
  if (!isObj(f)) return fail(`floors[${i}]`);
  const { id, name, imageId, imageW, imageH, sim, r0 } = f;
  if (!isStr(id) || !isStr(name) || !isStr(imageId)) fail(`floors[${i}] 필드`);
  if (!isNum(imageW) || !isNum(imageH) || imageW <= 0 || imageH <= 0) fail(`floors[${i}] 크기`);
  if (!isObj(sim) || !isNum(sim.r) || sim.r <= 0 || !isVec(sim.d)) fail(`floors[${i}].sim`);
  if (!isNum(r0) || r0 <= 0) fail(`floors[${i}].r0`);
  return f as unknown as Floor;
}

function checkMarker(m: unknown, i: number, floorIds: Set<string>): Marker {
  if (!isObj(m)) return fail(`markers[${i}]`);
  if (!isStr(m.id) || !isStr(m.label) || !isNum(m.createdAt)) fail(`markers[${i}] 필드`);
  if (!MARKER_KINDS.includes(m.type as MarkerType)) fail(`markers[${i}].type`);
  const s = m.scope;
  if (!isObj(s)) return fail(`markers[${i}].scope`);
  if (s.kind === 'floor') {
    if (!isStr(s.floorId) || !floorIds.has(s.floorId) || !isVec(s.p)) fail(`markers[${i}].scope`);
  } else if (s.kind === 'through') {
    if (!Array.isArray(s.floorIds) || s.floorIds.length === 0 || !s.floorIds.every((x) => floorIds.has(x)) || !isVec(s.w))
      fail(`markers[${i}].scope`);
  } else fail(`markers[${i}].scope.kind`);
  return m as unknown as Marker;
}

/** 파싱 + 구조 검증. 실패하면 사용자에게 보여줄 한국어 메시지로 throw. */
export function parseMapops(text: string): MapopsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('JSON 해석 실패');
  }
  if (!isObj(raw) || raw.format !== MAPOPS_FORMAT) return fail('형식 표시 없음');
  if (!isNum(raw.version) || raw.version > MAPOPS_VERSION) fail('지원하지 않는 버전');
  const map = raw.map;
  if (!isObj(map) || !isStr(map.id) || !isStr(map.name) || !isStr(map.anchorFloorId)) return fail('map');
  if (!Array.isArray(map.floors) || map.floors.length === 0) return fail('층 없음');
  const floors = map.floors.map(checkFloor);
  const floorIds = new Set(floors.map((f) => f.id));
  if (!floorIds.has(map.anchorFloorId)) fail('기준층 없음');
  if (!Array.isArray(map.markers)) return fail('markers');
  map.markers.forEach((m, i) => checkMarker(m, i, floorIds));
  const images = raw.images;
  if (!isObj(images)) return fail('images');
  for (const f of floors) {
    const img = images[f.imageId];
    if (!isObj(img) || !isStr(img.data) || !isStr(img.type)) fail(`이미지 누락: ${f.name}`);
  }
  return raw as unknown as MapopsFile;
}
