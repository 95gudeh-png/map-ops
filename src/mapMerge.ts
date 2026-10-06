/**
 * 중복 맵 감지·합치기. 같은 단면도로 서로 다른 곳(예: localhost와 공개 사이트)에서 따로 만든 맵은
 * 이름·이미지가 같아도 ID가 달라 별개 맵이 된다. 층 이미지(내용 해시) 집합이 같으면 중복으로 본다.
 *
 * 합치기: 남길 맵(target)에 지울 맵(source)의 마커·낙서를 옮긴다. 층은 이미지 해시로 짝짓는다.
 * - 단일층 마커·낙서: 같은 이미지의 층이면 이미지 픽셀 좌표를 그대로 쓴다(정렬이 달라도 정확).
 * - 관통 마커: source 월드 → (source 기준층 로컬) → 같은 이미지의 target 층 → target 월드로 환산.
 * - 이미 같은 것이 있으면(유형·이름·층·위치 1px 이내) 건너뛴다.
 */
import { localToWorld, worldToLocal, type Vec } from './geometry';
import { newId, type Floor, type GameMap, type Id, type Marker, type Stroke } from './model';

/** 층 이미지 집합으로 묶은 중복 그룹(2개 이상인 것만). 각 그룹은 추가된 순서. */
export function findDuplicateGroups(maps: GameMap[]): GameMap[][] {
  const groups = new Map<string, GameMap[]>();
  for (const m of maps) {
    if (m.floors.length === 0) continue;
    const key = [...new Set(m.floors.map((f) => f.imageId))].sort().join('|');
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export interface MergeResult {
  map: GameMap;
  markersAdded: number;
  strokesAdded: number;
  /** 짝이 맞는 층이 없어 옮기지 못한 항목 수. */
  skipped: number;
}

const close = (a: Vec, b: Vec, tol = 1) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

export function mergeMaps(target: GameMap, source: GameMap, now = Date.now()): MergeResult {
  const byImage = new Map<string, Floor>();
  for (const f of target.floors) if (!byImage.has(f.imageId)) byImage.set(f.imageId, f);
  const srcFloor = new Map(source.floors.map((f) => [f.id, f]));
  const mapFloor = (srcFloorId: Id): Floor | undefined => {
    const f = srcFloor.get(srcFloorId);
    return f && byImage.get(f.imageId);
  };
  const srcAnchor = source.floors.find((f) => f.id === source.anchorFloorId) ?? source.floors[0];
  const tgtAnchorTwin = srcAnchor && byImage.get(srcAnchor.imageId);
  /** source 월드 좌표를 target 월드 좌표로(기준층 이미지가 짝지어질 때만). */
  const toTargetWorld = (w: Vec): Vec | null =>
    srcAnchor && tgtAnchorTwin ? localToWorld(tgtAnchorTwin.sim, worldToLocal(srcAnchor.sim, w)) : null;

  const markers: Marker[] = [...target.markers];
  const strokes: Stroke[] = [...(target.strokes ?? [])];
  let markersAdded = 0, strokesAdded = 0, skipped = 0;

  const exists = (m: Marker) =>
    markers.some((t) => {
      if (t.type !== m.type || t.label !== m.label || t.scope.kind !== m.scope.kind) return false;
      if (t.scope.kind === 'floor' && m.scope.kind === 'floor') return t.scope.floorId === m.scope.floorId && close(t.scope.p, m.scope.p);
      if (t.scope.kind === 'through' && m.scope.kind === 'through') return close(t.scope.w, m.scope.w);
      return false;
    });

  for (const m of source.markers) {
    let next: Marker | null = null;
    if (m.scope.kind === 'floor') {
      const f = mapFloor(m.scope.floorId);
      if (f) next = { ...m, id: newId(), scope: { kind: 'floor', floorId: f.id, p: m.scope.p } };
    } else {
      const w = toTargetWorld(m.scope.w);
      const ids = m.scope.floorIds.map((id) => mapFloor(id)?.id).filter((id): id is Id => !!id);
      const ordered = target.floors.map((f) => f.id).filter((id) => ids.includes(id));
      if (w && ordered.length) next = { ...m, id: newId(), scope: { kind: 'through', floorIds: ordered, w } };
    }
    if (!next) skipped++;
    else if (!exists(next)) {
      markers.push({ ...next, createdAt: next.createdAt || now });
      markersAdded++;
    }
  }

  for (const s of source.strokes ?? []) {
    const f = mapFloor(s.floorId);
    if (!f) {
      skipped++;
      continue;
    }
    const dup = strokes.some((t) => t.floorId === f.id && t.color === s.color && t.points.join() === s.points.join());
    if (!dup) {
      strokes.push({ ...s, id: newId(), floorId: f.id });
      strokesAdded++;
    }
  }

  return { map: { ...target, markers, strokes }, markersAdded, strokesAdded, skipped };
}
