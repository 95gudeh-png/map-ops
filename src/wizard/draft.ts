/** 마법사 초안(= 편집 중인 GameMap) 조작. 모두 순수 함수. */
import { IDENTITY, initialPlacement } from '../geometry';
import { changeAnchor, findFloor, removeFloor, replaceFloorImage } from '../mapOps';
import { newId, type Floor, type GameMap, type Id } from '../model';

export interface ImageInfo {
  id: string;
  w: number;
  h: number;
}

export function emptyDraft(): GameMap {
  return { id: newId(), name: '', anchorFloorId: '', floors: [], markers: [], updatedAt: 0 };
}

/** "B1_basement.png" → "B1_basement" */
export function baseName(filename: string): string {
  const i = filename.lastIndexOf('.');
  return (i > 0 ? filename.slice(0, i) : filename).trim() || '이름 없는 층';
}

/** 층 추가. 첫 층은 기준층(항등), 이후 층은 기준층에 폭·중심을 맞춘 초기 배치. */
export function addFloor(draft: GameMap, img: ImageInfo, name: string): GameMap {
  const anchor = findFloor(draft, draft.anchorFloorId);
  const sim = anchor ? initialPlacement({ w: anchor.imageW, h: anchor.imageH }, { w: img.w, h: img.h }) : IDENTITY;
  const floor: Floor = { id: newId(), name, imageId: img.id, imageW: img.w, imageH: img.h, sim, r0: sim.r };
  return { ...draft, floors: [...draft.floors, floor], anchorFloorId: anchor ? draft.anchorFloorId : floor.id };
}

/** 층 삭제. 초안에서는 마지막 층도 지울 수 있다(빈 초안으로). */
export function deleteFloor(draft: GameMap, floorId: Id): { draft: GameMap; removedMarkers: number } {
  if (draft.floors.length === 1 && draft.floors[0]!.id === floorId) {
    return { draft: { ...draft, floors: [], anchorFloorId: '', markers: [] }, removedMarkers: draft.markers.length };
  }
  const r = removeFloor(draft, floorId);
  return { draft: r.map, removedMarkers: r.removedMarkers };
}

export function moveFloor(draft: GameMap, from: number, to: number): GameMap {
  if (from === to || from < 0 || to < 0 || from >= draft.floors.length || to >= draft.floors.length) return draft;
  const floors = draft.floors.slice();
  const [moved] = floors.splice(from, 1);
  floors.splice(to, 0, moved!);
  return { ...draft, floors };
}

export function renameFloor(draft: GameMap, floorId: Id, name: string): GameMap {
  return { ...draft, floors: draft.floors.map((f) => (f.id === floorId ? { ...f, name } : f)) };
}

export function setAnchor(draft: GameMap, floorId: Id): GameMap {
  return draft.anchorFloorId === floorId ? draft : changeAnchor(draft, floorId).map;
}

export function replaceImage(draft: GameMap, floorId: Id, img: ImageInfo): { draft: GameMap; aspectWarning: boolean } {
  const r = replaceFloorImage(draft, floorId, { imageId: img.id, w: img.w, h: img.h });
  return { draft: r.map, aspectWarning: r.aspectWarning };
}

/** 종속층을 초기 배치(기준층과 겹침)로 되돌린다. */
export function resetFloorPlacement(draft: GameMap, floorId: Id): GameMap {
  const anchor = findFloor(draft, draft.anchorFloorId);
  if (!anchor || floorId === anchor.id) return draft;
  return {
    ...draft,
    floors: draft.floors.map((f) => {
      if (f.id !== floorId) return f;
      const sim = initialPlacement({ w: anchor.imageW, h: anchor.imageH }, { w: f.imageW, h: f.imageH });
      return { ...f, sim, r0: sim.r };
    }),
  };
}

/** 정렬 대상(기준층 제외) — 목록 순서. */
export const calibTargets = (draft: GameMap): Floor[] => draft.floors.filter((f) => f.id !== draft.anchorFloorId);
