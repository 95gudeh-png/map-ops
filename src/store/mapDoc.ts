/**
 * GameMap ↔ Y.Doc 변환. 맵 하나 = Y.Doc 하나(공유 단위도 맵, 명세서 §4.5).
 *
 * 문서 구조
 * - meta:       Y.Map   { name, anchorFloorId, updatedAt }
 * - floorOrder: Y.Array<Id>        층 순서
 * - floors:     Y.Map<Id, Floor>   층 객체(통째로 교체)
 * - markers:    Y.Map<Id, Marker>  마커 객체(통째로 교체)
 *
 * 서로 다른 마커·층의 동시 편집은 병합되고, 같은 항목을 동시에 바꾸면 한쪽이 이긴다.
 */
import * as Y from 'yjs';
import type { Floor, GameMap, Id, Marker } from '../model';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function readMap(doc: Y.Doc, id: Id): GameMap | null {
  const meta = doc.getMap<unknown>('meta');
  const name = meta.get('name');
  if (typeof name !== 'string') return null;
  const floorsMap = doc.getMap<Floor>('floors');
  const floors = doc
    .getArray<Id>('floorOrder')
    .toArray()
    .map((fid) => floorsMap.get(fid))
    .filter((f): f is Floor => !!f);
  const markers = Array.from(doc.getMap<Marker>('markers').values()).sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );
  return {
    id,
    name,
    anchorFloorId: (meta.get('anchorFloorId') as Id) ?? floors[0]?.id ?? '',
    floors,
    markers,
    updatedAt: (meta.get('updatedAt') as number) ?? 0,
  };
}

/** 바뀐 항목만 기록한다(불필요한 동기화 트래픽과 병합 충돌 방지). */
export function writeMap(doc: Y.Doc, map: GameMap): void {
  doc.transact(() => {
    const meta = doc.getMap<unknown>('meta');
    if (meta.get('name') !== map.name) meta.set('name', map.name);
    if (meta.get('anchorFloorId') !== map.anchorFloorId) meta.set('anchorFloorId', map.anchorFloorId);
    meta.set('updatedAt', map.updatedAt);

    const order = doc.getArray<Id>('floorOrder');
    const ids = map.floors.map((f) => f.id);
    if (!same(order.toArray(), ids)) {
      order.delete(0, order.length);
      order.insert(0, ids);
    }

    syncEntries(doc.getMap<Floor>('floors'), map.floors);
    syncEntries(doc.getMap<Marker>('markers'), map.markers);
  });
}

function syncEntries<T extends { id: Id }>(ymap: Y.Map<T>, items: T[]) {
  const keep = new Set(items.map((x) => x.id));
  for (const key of Array.from(ymap.keys())) if (!keep.has(key)) ymap.delete(key);
  for (const item of items) if (!same(ymap.get(item.id), item)) ymap.set(item.id, item);
}
