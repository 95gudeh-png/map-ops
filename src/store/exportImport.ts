/** .mapops 내보내기/가져오기 — 저장소 연동부. */
import { newId, type GameMap } from '../model';
import { getImage, putImage } from './imageStore';
import { base64ToBytes, bytesToBase64, MAPOPS_FORMAT, MAPOPS_VERSION, parseMapops, type MapopsFile } from './mapopsFile';
import { repo } from './repo';

export async function exportMap(map: GameMap): Promise<Blob> {
  const images: MapopsFile['images'] = {};
  for (const f of map.floors) {
    if (images[f.imageId]) continue;
    const rec = await getImage(f.imageId);
    if (!rec) throw new Error(`이미지가 저장소에 없소: ${f.name}`);
    images[f.imageId] = {
      type: rec.blob.type || 'image/png',
      w: rec.w,
      h: rec.h,
      data: bytesToBase64(new Uint8Array(await rec.blob.arrayBuffer())),
    };
  }
  const file: MapopsFile = { format: MAPOPS_FORMAT, version: MAPOPS_VERSION, exportedAt: Date.now(), map, images };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
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

export async function exportMapToFile(map: GameMap) {
  downloadBlob(await exportMap(map), `${safeFilename(map.name)}.mapops`);
}

/**
 * 가져오기. 이미지는 내용 해시로 다시 저장한다(파일 속 ID를 믿지 않음).
 * 같은 ID의 맵이 이미 있으면 새 ID의 사본으로 추가한다.
 */
export async function importMapopsFile(file: File): Promise<GameMap> {
  const parsed = parseMapops(await file.text());
  const remap = new Map<string, string>();
  for (const [oldId, img] of Object.entries(parsed.images)) {
    const rec = await putImage(new Blob([base64ToBytes(img.data)], { type: img.type }));
    remap.set(oldId, rec.id);
  }
  const exists = !!repo.getMap(parsed.map.id);
  const map: GameMap = {
    ...parsed.map,
    id: exists ? newId() : parsed.map.id,
    name: exists ? `${parsed.map.name} (가져옴)` : parsed.map.name,
    floors: parsed.map.floors.map((f) => ({ ...f, imageId: remap.get(f.imageId) ?? f.imageId })),
    updatedAt: Date.now(),
  };
  await repo.createMap(map);
  return map;
}
