/** 마커 생성·수정·삭제·이동 (명세서 §3.2, §4.2). 순수 함수. */
import { worldToLocal, type Vec } from '../geometry';
import { findFloor, markerWorld } from '../mapOps';
import { newId, type GameMap, type Id, type Marker, type MarkerScope, type MarkerType } from '../model';

export interface MarkerInput {
  type: MarkerType;
  label: string;
  /** 월드 좌표(probe 위치). */
  w: Vec;
  /** 마커를 추가한 패널의 층. */
  originFloorId: Id;
  through: boolean;
  /** 관통일 때 표시할 층(origin 포함 여부와 무관하게 origin은 항상 포함된다). */
  floorIds: Id[];
}

/** 입력에 맞는 범위. 층간연결은 항상 관통, 관통인데 층이 하나뿐이면 단일층. */
export function scopeFor(map: GameMap, input: Pick<MarkerInput, 'type' | 'w' | 'originFloorId' | 'through' | 'floorIds'>): MarkerScope {
  const through = input.type === 'connector' || input.through;
  const order = map.floors.map((f) => f.id);
  const ids = order.filter((id) => id === input.originFloorId || (through && input.floorIds.includes(id)));
  if (through && (ids.length > 1 || input.type === 'connector')) return { kind: 'through', floorIds: ids, w: input.w };
  const floor = findFloor(map, input.originFloorId);
  if (!floor) throw new Error(`floor not found: ${input.originFloorId}`);
  return { kind: 'floor', floorId: floor.id, p: worldToLocal(floor.sim, input.w) };
}

export function addMarker(map: GameMap, input: MarkerInput, id: Id = newId(), now = Date.now()): { map: GameMap; marker: Marker } {
  const marker: Marker = { id, type: input.type, label: input.label.trim(), scope: scopeFor(map, input), createdAt: now };
  return { map: { ...map, markers: [...map.markers, marker] }, marker };
}

export function deleteMarker(map: GameMap, id: Id): GameMap {
  return { ...map, markers: map.markers.filter((m) => m.id !== id) };
}

/** 이름·유형·범위 수정. 위치(월드)는 유지한다. */
export function updateMarker(map: GameMap, id: Id, input: Omit<MarkerInput, 'w'> & { w: Vec }): GameMap {
  return {
    ...map,
    markers: map.markers.map((m) =>
      m.id === id ? { ...m, type: input.type, label: input.label.trim(), scope: scopeFor(map, input) } : m,
    ),
  };
}

/** 마커를 새 월드 좌표로 이동. 단일층은 그 층 로컬 좌표로 환산한다. */
export function moveMarker(map: GameMap, id: Id, w: Vec): GameMap {
  return {
    ...map,
    markers: map.markers.map((m) => {
      if (m.id !== id) return m;
      if (m.scope.kind === 'through') return { ...m, scope: { ...m.scope, w } };
      const floor = findFloor(map, m.scope.floorId);
      return floor ? { ...m, scope: { ...m.scope, p: worldToLocal(floor.sim, w) } } : m;
    }),
  };
}

/** "관통: 1층·2층" 같은 표시용 문자열. */
export function throughFloorsLabel(map: GameMap, m: Marker): string {
  if (m.scope.kind !== 'through') return '';
  const ids = m.scope.floorIds;
  return map.floors
    .filter((f) => ids.includes(f.id))
    .map((f) => f.name)
    .join('·');
}

/**
 * 단일층 ↔ 관통 전환(목록에서 끌어다 놓기). 위치(월드)는 그대로 둔다.
 * - 관통으로: floorIds(기본 층)를 쓰되 원래 층은 항상 포함. 층이 하나뿐이면 바꾸지 않는다.
 * - 단일층으로: toFloorId 층의 이미지 좌표로 환산. 층간연결은 관통만 가능하므로 바꾸지 않는다.
 * 바뀌지 않았으면 같은 맵 객체를 돌려준다.
 */
export function convertMarkerScope(map: GameMap, id: Id, to: 'floor' | 'through', opts: { toFloorId: Id; floorIds: Id[] }): GameMap {
  const m = map.markers.find((x) => x.id === id);
  if (!m || m.scope.kind === to) return map;
  const w = markerWorld(map, m);
  if (!w) return map;
  if (to === 'floor') {
    if (m.type === 'connector') return map;
    const floor = findFloor(map, opts.toFloorId);
    if (!floor) return map;
    return { ...map, markers: map.markers.map((x) => (x.id === id ? { ...x, scope: { kind: 'floor', floorId: floor.id, p: worldToLocal(floor.sim, w) } } : x)) };
  }
  const origin = m.scope.kind === 'floor' ? m.scope.floorId : opts.toFloorId;
  const ids = map.floors.map((f) => f.id).filter((fid) => fid === origin || opts.floorIds.includes(fid));
  if (ids.length < 2) return map;
  return { ...map, markers: map.markers.map((x) => (x.id === id ? { ...x, scope: { kind: 'through', floorIds: ids, w } } : x)) };
}

