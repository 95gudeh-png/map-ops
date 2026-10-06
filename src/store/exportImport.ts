/** .mapops 내보내기/가져오기 — 저장소 연동부. 여러 맵을 파일 하나로 묶거나, 여러 파일을 한 번에 가져온다. */
import { mergeMaps } from '../mapMerge';
import { newId, type GameMap, type Id } from '../model';
import { getImage, putImage } from './imageStore';
import { base64ToBytes, buildBundle, bytesToBase64, parseMapops, type MapopsImage } from './mapopsFile';
import { repo } from './repo';

/* ---------- 내보내기 ---------- */

export async function exportMaps(maps: GameMap[]): Promise<Blob> {
  const images: Record<string, MapopsImage> = {};
  for (const map of maps) {
    for (const f of map.floors) {
      if (images[f.imageId]) continue;
      const rec = await getImage(f.imageId);
      if (!rec) throw new Error(`이미지가 저장소에 없소: ${map.name} / ${f.name}`);
      images[f.imageId] = {
        type: rec.blob.type || 'image/png',
        w: rec.w,
        h: rec.h,
        data: bytesToBase64(new Uint8Array(await rec.blob.arrayBuffer())),
      };
    }
  }
  return new Blob([JSON.stringify(buildBundle(maps, images))], { type: 'application/json' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeFilename = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'map';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};

/** 맵 하나면 맵 이름으로, 여러 개면 "MAP-OPS-맵N개-날짜"로 저장. */
export async function exportMapsToFile(maps: GameMap[]) {
  if (maps.length === 0) return;
  const name = maps.length === 1 ? safeFilename(maps[0]!.name) : `MAP-OPS-맵${maps.length}개-${today()}`;
  downloadBlob(await exportMaps(maps), `${name}.mapops`);
}

export const exportMapToFile = (map: GameMap) => exportMapsToFile([map]);

/* ---------- 가져오기 ---------- */

export type ImportPolicy = 'merge' | 'skip' | 'copy';

export interface ImportItem {
  map: GameMap;
  /** 이미 이 기기에 있는 같은 맵(ID가 같거나, 층 이미지가 모두 같은 맵). */
  match?: GameMap;
  matchBy?: 'id' | 'images';
  file: string;
}

export interface ImportPlan {
  items: ImportItem[];
  images: Record<string, MapopsImage>;
  /** 읽지 못한 파일과 이유. */
  errors: string[];
}

const imageKey = (m: GameMap) => [...new Set(m.floors.map((f) => f.imageId))].sort().join('|');

/** 파일들을 읽고, 이미 있는 맵과 짝을 지어 둔다(아직 아무것도 저장하지 않음). */
export async function planImport(files: File[]): Promise<ImportPlan> {
  const items: ImportItem[] = [];
  const images: Record<string, MapopsImage> = {};
  const errors: string[] = [];
  const seen = new Set<Id>();
  const existing = repo.getSnapshot();
  const byImages = new Map(existing.map((m) => [imageKey(m), m]));
  for (const file of files) {
    try {
      const bundle = parseMapops(await file.text());
      Object.assign(images, bundle.images);
      for (const map of bundle.maps) {
        if (seen.has(map.id)) continue; // 여러 파일에 같은 맵이 있으면 처음 것만
        seen.add(map.id);
        const byId = repo.getMap(map.id);
        const byImg = byId ? undefined : byImages.get(imageKey(map));
        items.push({ map, file: file.name, ...(byId ? { match: byId, matchBy: 'id' as const } : byImg ? { match: byImg, matchBy: 'images' as const } : {}) });
      }
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { items, images, errors };
}

export interface ImportResult {
  added: number;
  merged: number;
  skipped: number;
  copied: number;
  /** 새로 생긴 맵 ID(세션 자동 추가 등에 사용). */
  createdIds: Id[];
}

/** 계획대로 가져온다. 이미지는 내용 해시로 다시 저장한다(파일 속 ID를 믿지 않음). */
export async function applyImport(plan: ImportPlan, policy: ImportPolicy): Promise<ImportResult> {
  const result: ImportResult = { added: 0, merged: 0, skipped: 0, copied: 0, createdIds: [] };
  const needed = plan.items.filter((it) => !(it.match && policy === 'skip'));
  const remap = new Map<string, string>();
  for (const it of needed) {
    for (const f of it.map.floors) {
      if (remap.has(f.imageId)) continue;
      const img = plan.images[f.imageId]!;
      const rec = await putImage(new Blob([base64ToBytes(img.data)], { type: img.type }));
      remap.set(f.imageId, rec.id);
    }
  }
  for (const it of plan.items) {
    if (it.match && policy === 'skip') {
      result.skipped++;
      continue;
    }
    const map: GameMap = { ...it.map, floors: it.map.floors.map((f) => ({ ...f, imageId: remap.get(f.imageId) ?? f.imageId })) };
    if (!it.match) {
      await repo.createMap({ ...map, updatedAt: Date.now() });
      result.added++;
      result.createdIds.push(map.id);
    } else if (policy === 'merge') {
      const target = repo.getMap(it.match.id) ?? it.match;
      repo.saveMap(mergeMaps(target, map).map);
      result.merged++;
    } else {
      const id = newId();
      await repo.createMap({ ...map, id, name: `${map.name} (가져옴)`, updatedAt: Date.now() });
      result.copied++;
      result.createdIds.push(id);
    }
  }
  return result;
}

export function describeImport(r: ImportResult): string {
  const parts = [
    r.added && `새 맵 ${r.added}개`,
    r.merged && `기존 맵에 합침 ${r.merged}개`,
    r.copied && `사본 ${r.copied}개`,
    r.skipped && `건너뜀 ${r.skipped}개`,
  ].filter(Boolean);
  return parts.length ? `가져왔소: ${parts.join(', ')}.` : '가져온 맵이 없소.';
}
