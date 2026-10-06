/**
 * 개발용 샘플 맵. 같은 건물의 층들을 서로 다른 해상도·여백으로 그려서
 * 실제 단면도처럼 정렬이 필요한 이미지를 만든다(정답 정렬값도 함께 계산).
 */
import { vec } from '../geometry';
import { newId, type Floor, type GameMap, type Marker } from '../model';
import { putImage } from '../store/imageStore';

/** 건물 좌표(단위 u, 60×40)를 이미지 픽셀로: p = s·u + o */
interface FloorSpec {
  name: string;
  w: number;
  h: number;
  s: number;
  o: { x: number; y: number };
  tint: string;
  rooms: [number, number, number, number, string][];
}

const STAIRS: [number, number, number, number] = [26, 16, 6, 8];
const HATCH = { x: 44, y: 30 };

const SPECS: FloorSpec[] = [
  {
    name: '지하',
    w: 900, h: 700, s: 13, o: { x: 60, y: 90 }, tint: '#2b2f3a',
    rooms: [[2, 2, 20, 16, '보일러실'], [36, 2, 22, 18, '창고'], [2, 24, 30, 14, '금고']],
  },
  {
    name: '1층',
    w: 1200, h: 800, s: 18, o: { x: 60, y: 40 }, tint: '#26323b',
    rooms: [[2, 2, 22, 14, '로비'], [36, 2, 22, 12, '사무실'], [2, 26, 20, 12, '창구'], [36, 22, 22, 16, '회의실']],
  },
  {
    name: '2층',
    w: 1800, h: 1300, s: 27, o: { x: 90, y: 110 }, tint: '#33302a',
    rooms: [[2, 2, 18, 18, 'CEO실'], [36, 2, 22, 14, '보안실'], [2, 26, 26, 12, '기록실'], [36, 20, 22, 18, '휴게실']],
  },
];

async function drawFloor(spec: FloorSpec): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = spec.w;
  c.height = spec.h;
  const g = c.getContext('2d')!;
  const P = (x: number, y: number) => [spec.s * x + spec.o.x, spec.s * y + spec.o.y] as const;

  g.fillStyle = '#101317';
  g.fillRect(0, 0, spec.w, spec.h);
  // 외벽
  const [x0, y0] = P(0, 0);
  g.fillStyle = spec.tint;
  g.fillRect(x0, y0, 60 * spec.s, 40 * spec.s);
  g.strokeStyle = '#c9d1db';
  g.lineWidth = Math.max(2, spec.s * 0.35);
  g.strokeRect(x0, y0, 60 * spec.s, 40 * spec.s);
  // 방
  g.font = `${Math.round(spec.s * 1.1)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [x, y, w, h, label] of spec.rooms) {
    const [rx, ry] = P(x, y);
    g.lineWidth = Math.max(1, spec.s * 0.15);
    g.strokeStyle = '#8b96a5';
    g.strokeRect(rx, ry, w * spec.s, h * spec.s);
    g.fillStyle = '#aab4c0';
    g.fillText(label, rx + (w * spec.s) / 2, ry + (h * spec.s) / 2);
  }
  // 계단(모든 층 같은 물리 위치)
  const [sx, sy] = P(STAIRS[0], STAIRS[1]);
  g.strokeStyle = '#e0a83e';
  g.lineWidth = Math.max(1, spec.s * 0.12);
  for (let i = 0; i <= 8; i++) {
    g.beginPath();
    g.moveTo(sx, sy + i * spec.s);
    g.lineTo(sx + STAIRS[2] * spec.s, sy + i * spec.s);
    g.stroke();
  }
  // 해치
  const [hx, hy] = P(HATCH.x, HATCH.y);
  g.strokeStyle = '#e0555a';
  g.lineWidth = Math.max(2, spec.s * 0.2);
  g.strokeRect(hx - spec.s, hy - spec.s, spec.s * 2, spec.s * 2);
  // 층 이름(좌상단 여백)
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.font = `bold ${Math.round(spec.s * 1.6)}px sans-serif`;
  g.fillStyle = '#e7ebf0';
  g.fillText(spec.name, 10, 8);

  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

export async function createSampleMap(): Promise<GameMap> {
  const anchorSpec = SPECS[1]!; // 1층이 기준층
  const floors: Floor[] = [];
  for (const spec of SPECS) {
    const img = await putImage(await drawFloor(spec));
    // 정답 정렬: world(=1층 픽셀) = sA·u + oA,  u = (p − o)/s
    const r = anchorSpec.s / spec.s;
    const d = vec(anchorSpec.o.x - r * spec.o.x, anchorSpec.o.y - r * spec.o.y);
    floors.push({ id: newId(), name: spec.name, imageId: img.id, imageW: img.w, imageH: img.h, sim: { r, d }, r0: r });
  }
  const [b1, f1, f2] = floors as [Floor, Floor, Floor];
  const world = (u: { x: number; y: number }) => vec(anchorSpec.s * u.x + anchorSpec.o.x, anchorSpec.s * u.y + anchorSpec.o.y);
  const now = Date.now();
  const markers: Marker[] = [
    { id: newId(), type: 'connector', label: '해치', scope: { kind: 'through', floorIds: [b1.id, f1.id, f2.id], w: world(HATCH) }, createdAt: now },
    { id: newId(), type: 'objective', label: '금고', scope: { kind: 'floor', floorId: b1.id, p: vec(13 * 17 + 60, 13 * 31 + 90) }, createdAt: now + 1 },
    { id: newId(), type: 'camera', label: '로비 카메라', scope: { kind: 'floor', floorId: f1.id, p: vec(18 * 4 + 60, 18 * 4 + 40) }, createdAt: now + 2 },
  ];
  return { id: newId(), name: '샘플: 은행', anchorFloorId: f1.id, floors, markers, updatedAt: now };
}
