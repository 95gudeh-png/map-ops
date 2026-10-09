/** 맵 단위 순수 연산: 기준층 변경, 층 삭제, 이미지 교체 (명세서 §3.5, §4.4). */
import {
  aspectDiffers,
  localToWorld,
  reanchor,
  replaceImage,
  worldToLocal,
  type Vec,
  type View,
} from './geometry';
import type { Floor, GameMap, Id, Marker, Stroke } from './model';

export function findFloor(map: GameMap, floorId: Id): Floor | undefined {
  return map.floors.find((f) => f.id === floorId);
}

/** 마커의 월드 좌표. 층을 찾지 못하면 null. */
export function markerWorld(map: GameMap, m: Marker): Vec | null {
  if (m.scope.kind === 'through') return m.scope.w;
  const floor = findFloor(map, m.scope.floorId);
  return floor ? localToWorld(floor.sim, m.scope.p) : null;
}

/** 마커가 해당 층에 표시되는지. */
export function markerOnFloor(m: Marker, floorId: Id): boolean {
  return m.scope.kind === 'floor' ? m.scope.floorId === floorId : m.scope.floorIds.includes(floorId);
}

/**
 * 기준층 변경. 시각적 배치를 유지한다.
 * view를 넘기면 화면이 그대로 보이도록 보정한 뷰도 돌려준다.
 */
export function changeAnchor(map: GameMap, newAnchorId: Id, view?: View): { map: GameMap; view?: View } {
  const target = findFloor(map, newAnchorId);
  if (!target) throw new Error(`floor not found: ${newAnchorId}`);
  const t = reanchor(target.sim);
  // r0(배율 clamp 기준)도 같은 비율로 나눠야 r/r0 허용 범위가 유지된다.
  const floors = map.floors.map((f) => ({
    ...f,
    sim: f.id === newAnchorId ? { r: 1, d: { x: 0, y: 0 } } : t.sim(f.sim),
    r0: f.r0 / target.sim.r,
  }));
  const markers = map.markers.map((m) =>
    m.scope.kind === 'through' ? { ...m, scope: { ...m.scope, w: t.world(m.scope.w) } } : m,
  );
  // 관통 획은 월드 좌표이므로 관통 마커처럼 새 기준으로 옮긴다(굵기도 같은 비율)
  const rB = target.sim.r;
  const strokes = map.strokes?.map((s) => {
    if (!s.floorIds) return s;
    const pts: number[] = [];
    for (let i = 0; i + 1 < s.points.length; i += 2) {
      const w = t.world({ x: s.points[i]!, y: s.points[i + 1]! });
      pts.push(w.x, w.y);
    }
    return { ...s, points: pts, width: s.width / rB };
  });
  return {
    map: { ...map, anchorFloorId: newAnchorId, floors, markers, ...(strokes ? { strokes } : {}) },
    view: view ? t.view(view) : undefined,
  };
}

/** 층을 지울 때 낙서 정리: 그 층 단일층 획은 삭제, 관통 획은 그 층만 빼고(다 빠지면 삭제). */
function dropFloorFromStrokes(strokes: Stroke[], floorId: Id): Stroke[] {
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (!s.floorIds) {
      if (s.floorId !== floorId) out.push(s);
      continue;
    }
    const ids = s.floorIds.filter((id) => id !== floorId);
    if (ids.length) out.push({ ...s, floorIds: ids, floorId: ids.includes(s.floorId) ? s.floorId : ids[0]! });
  }
  return out;
}

export interface RemoveFloorResult {
  map: GameMap;
  /** 함께 삭제된 단일층 마커 수(사용자 확인용). */
  removedMarkers: number;
}

/** 층 삭제. 최소 1개 층은 남긴다. 기준층이면 다른 층으로 기준을 먼저 옮긴다. */
export function removeFloor(map: GameMap, floorId: Id): RemoveFloorResult {
  if (map.floors.length <= 1) throw new Error('최소 1개 층은 남아야 하오.');
  if (!findFloor(map, floorId)) throw new Error(`floor not found: ${floorId}`);

  let cur = map;
  if (cur.anchorFloorId === floorId) {
    const next = cur.floors.find((f) => f.id !== floorId)!;
    cur = changeAnchor(cur, next.id).map;
  }

  let removedMarkers = 0;
  const markers: Marker[] = [];
  for (const m of cur.markers) {
    if (m.scope.kind === 'floor') {
      if (m.scope.floorId === floorId) removedMarkers++;
      else markers.push(m);
      continue;
    }
    const floorIds = m.scope.floorIds.filter((id) => id !== floorId);
    if (floorIds.length === 0) {
      removedMarkers++;
    } else if (floorIds.length === 1 && m.type !== 'connector') {
      const only = findFloor(cur, floorIds[0]!)!;
      markers.push({ ...m, scope: { kind: 'floor', floorId: only.id, p: worldToLocal(only.sim, m.scope.w) } });
    } else {
      markers.push({ ...m, scope: { ...m.scope, floorIds } });
    }
  }

  return {
    map: {
      ...cur,
      floors: cur.floors.filter((f) => f.id !== floorId),
      markers,
      ...(cur.strokes ? { strokes: dropFloorFromStrokes(cur.strokes, floorId) } : {}),
    },
    removedMarkers,
  };
}

/**
 * 편집 마법사 저장 시 병합. 편집하는 동안 다른 사람이 바꾼 마커를 잃지 않도록 한다.
 * - 초안에 있는 마커: 초안 값(기준층 변경 등으로 변환된 값)
 * - 편집 시작 후 새로 생긴 마커: 현재 값 유지(층이 사라졌으면 그 층만 제외)
 * - 편집 시작 때 있었는데 초안에 없는 마커: 편집으로 삭제된 것이므로 제외
 * - 편집 중 다른 사람이 지운 마커: 제외
 */
export function mergeEditedMap(initial: GameMap, draft: GameMap, current: GameMap | undefined): GameMap {
  if (!current) return draft;
  const inDraft = new Map(draft.markers.map((m) => [m.id, m]));
  const inInitial = new Set(initial.markers.map((m) => m.id));
  const floorIds = new Set(draft.floors.map((f) => f.id));
  const markers: Marker[] = [];
  for (const m of current.markers) {
    const d = inDraft.get(m.id);
    if (d) {
      markers.push(d);
      continue;
    }
    if (inInitial.has(m.id)) continue;
    if (m.scope.kind === 'floor') {
      if (floorIds.has(m.scope.floorId)) markers.push(m);
    } else {
      const ids = m.scope.floorIds.filter((id) => floorIds.has(id));
      if (ids.length) markers.push({ ...m, scope: { ...m.scope, floorIds: ids } });
    }
  }
  // 낙서도 같은 규칙: 초안 값 우선, 편집 중 새로 생긴 획은 층이 남아 있으면 유지
  const draftStrokes = new Map((draft.strokes ?? []).map((s) => [s.id, s]));
  const initialStrokes = new Set((initial.strokes ?? []).map((s) => s.id));
  const strokes: Stroke[] = [];
  for (const s of current.strokes ?? []) {
    const d = draftStrokes.get(s.id);
    if (d) strokes.push(d);
    else if (initialStrokes.has(s.id)) continue;
    else if (s.floorIds) {
      const ids = s.floorIds.filter((id) => floorIds.has(id));
      if (ids.length) strokes.push({ ...s, floorIds: ids });
    } else if (floorIds.has(s.floorId)) strokes.push(s);
  }
  return { ...draft, markers, strokes };
}

export interface NewImage {
  imageId: string;
  w: number;
  h: number;
}

/** 층 이미지 교체. 그 층의 단일층 마커는 같은 화면 위치를 유지한다. */
export function replaceFloorImage(
  map: GameMap,
  floorId: Id,
  img: NewImage,
): { map: GameMap; aspectWarning: boolean } {
  const floor = findFloor(map, floorId);
  if (!floor) throw new Error(`floor not found: ${floorId}`);
  const rep = replaceImage(floor.sim, floor.imageW, img.w);
  const k = floor.imageW / img.w;
  const aspectWarning = aspectDiffers({ w: floor.imageW, h: floor.imageH }, img);

  let next: GameMap = {
    ...map,
    floors: map.floors.map((f) =>
      f.id === floorId ? { ...f, imageId: img.imageId, imageW: img.w, imageH: img.h, sim: rep.sim, r0: f.r0 * k } : f,
    ),
    markers: map.markers.map((m) =>
      m.scope.kind === 'floor' && m.scope.floorId === floorId
        ? { ...m, scope: { ...m.scope, p: rep.local(m.scope.p) } }
        : m,
    ),
    // 그 층 단일층 낙서도 새 이미지 픽셀로(같은 화면 위치·굵기 유지). 관통 획은 월드 좌표라 그대로.
    ...(map.strokes
      ? {
          strokes: map.strokes.map((s) =>
            !s.floorIds && s.floorId === floorId ? { ...s, width: s.width / k, points: s.points.map((v) => v / k) } : s,
          ),
        }
      : {}),
  };
  // 기준층이면 항등으로 되돌린다.
  if (map.anchorFloorId === floorId) next = changeAnchor(next, floorId).map;
  return { map: next, aspectWarning };
}
