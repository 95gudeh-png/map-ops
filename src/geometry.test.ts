import { describe, expect, it } from 'vitest';
import {
  composeToScreen,
  dragFloor,
  fitView,
  initialPlacement,
  localToWorld,
  reanchor,
  replaceImage,
  scaleFloorAt,
  screenToWorld,
  SCALE_RATIO_MAX,
  SCALE_RATIO_MIN,
  vec,
  worldToLocal,
  worldToScreen,
  zoomViewAt,
  type Sim,
  type Vec,
  type View,
} from './geometry';

/** 결정적 난수(mulberry32) — 실패 재현을 위해 시드 고정. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const between = (a: number, b: number) => a + (b - a) * rand();
const randVec = (span = 2000): Vec => vec(between(-span, span), between(-span, span));
const randSim = (): Sim => ({ r: between(0.2, 4), d: randVec() });
const randView = (): View => ({ z: between(0.1, 6), pan: randVec() });

const close = (a: Vec, b: Vec) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

const CASES = 200;

describe('기본 변환', () => {
  it('localToWorld ∘ worldToLocal = 항등', () => {
    for (let i = 0; i < CASES; i++) {
      const s = randSim(), p = randVec();
      close(worldToLocal(s, localToWorld(s, p)), p);
    }
  });

  it('screenToWorld ∘ worldToScreen = 항등', () => {
    for (let i = 0; i < CASES; i++) {
      const v = randView(), w = randVec();
      close(screenToWorld(v, worldToScreen(v, w)), w);
    }
  });

  it('composeToScreen은 층 픽셀을 화면으로 한 번에 보낸다', () => {
    for (let i = 0; i < CASES; i++) {
      const v = randView(), s = randSim(), p = randVec();
      close(localToWorld(composeToScreen(v, s), p), worldToScreen(v, localToWorld(s, p)));
    }
  });
});

describe('뷰 줌/맞춤', () => {
  it('커서 아래 월드 점은 줌 전후 같다', () => {
    for (let i = 0; i < CASES; i++) {
      const v = randView(), cursor = randVec(800);
      const before = screenToWorld(v, cursor);
      const v2 = zoomViewAt(v, cursor, rand() < 0.5 ? 1.15 : 1 / 1.15, 0.01, 100);
      close(screenToWorld(v2, cursor), before);
    }
  });

  it('줌 범위를 넘으면 clamp되고 범위 끝에서는 변화 없음', () => {
    const v: View = { z: 6, pan: vec(10, 20) };
    expect(zoomViewAt(v, vec(5, 5), 1.15, 0.5, 6)).toBe(v);
    expect(zoomViewAt({ z: 5.9, pan: vec(0, 0) }, vec(0, 0), 1.15, 0.5, 6).z).toBe(6);
  });

  it('fitView는 사각형을 화면 중앙에 여백 포함으로 맞춘다', () => {
    const v = fitView({ x: 100, y: 50, w: 2000, h: 1000 }, { w: 1000, h: 1000 }, 0.9);
    expect(v.z).toBeCloseTo(0.45);
    close(worldToScreen(v, vec(1100, 550)), vec(500, 500)); // 사각형 중심 → 화면 중심
    const tl = worldToScreen(v, vec(100, 50));
    expect(tl.x).toBeCloseTo(50); // 좌우 5%씩 여백
  });
});

describe('정렬: 종속층 조작', () => {
  it('초기 배치: 폭과 중심이 기준층과 일치', () => {
    const anchor = { w: 1175, h: 1032 }, floor = { w: 2560, h: 1440 };
    const s = initialPlacement(anchor, floor);
    expect(floor.w * s.r).toBeCloseTo(anchor.w);
    close(localToWorld(s, vec(floor.w / 2, floor.h / 2)), vec(anchor.w / 2, anchor.h / 2));
  });

  it('뷰 줌 상태에서 드래그하면 화면상 정확히 Δs만큼 움직인다', () => {
    for (let i = 0; i < CASES; i++) {
      const v = randView(), s = randSim(), p = randVec(), delta = randVec(300);
      const before = worldToScreen(v, localToWorld(s, p));
      const after = worldToScreen(v, localToWorld(dragFloor(s, delta, v), p));
      close(after, vec(before.x + delta.x, before.y + delta.y));
    }
  });

  it('Ctrl+휠 배율: 커서 아래 층 픽셀이 고정된다', () => {
    for (let i = 0; i < CASES; i++) {
      const v = randView(), s = randSim(), cursor = randVec(800);
      const pixelUnderCursor = worldToLocal(s, screenToWorld(v, cursor));
      const s2 = scaleFloorAt(s, cursor, v, rand() < 0.5 ? 1.08 : 1 / 1.08, s.r);
      close(worldToScreen(v, localToWorld(s2, pixelUnderCursor)), cursor);
    }
  });

  it('배율은 r0 기준 [0.3, 3]배로 제한된다', () => {
    const v: View = { z: 1, pan: vec(0, 0) };
    let s: Sim = { r: 0.5, d: vec(0, 0) };
    for (let i = 0; i < 100; i++) s = scaleFloorAt(s, vec(10, 10), v, 1.08, 0.5);
    expect(s.r).toBeCloseTo(0.5 * SCALE_RATIO_MAX);
    for (let i = 0; i < 200; i++) s = scaleFloorAt(s, vec(10, 10), v, 1 / 1.08, 0.5);
    expect(s.r).toBeCloseTo(0.5 * SCALE_RATIO_MIN);
  });
});

describe('기준층 변경 (§3.5)', () => {
  it('모든 층 픽셀과 관통 마커의 화면 위치가 변하지 않는다', () => {
    for (let i = 0; i < CASES; i++) {
      const v = randView();
      const floors = [randSim(), randSim(), randSim()];
      const B = floors[Math.floor(rand() * 3)]!;
      const t = reanchor(B);
      const v2 = t.view(v);

      for (const s of floors) {
        const p = randVec();
        close(worldToScreen(v2, localToWorld(t.sim(s), p)), worldToScreen(v, localToWorld(s, p)));
      }
      const w = randVec();
      close(worldToScreen(v2, t.world(w)), worldToScreen(v, w));

      const newB = t.sim(B);
      expect(newB.r).toBeCloseTo(1);
      close(newB.d, vec(0, 0));
    }
  });

  it('v1 프로토타입 버그 회귀: 기준층 배율이 1이 아닐 때도 강체로 따라온다', () => {
    // 기준층 A가 2배 확대된 상태에서 종속층의 상대 위치를 다시 구하면 원래 배치가 나와야 한다.
    const A: Sim = { r: 2, d: vec(100, 50) };
    const rel: Sim = { r: 0.8, d: vec(30, -20) }; // A 로컬 기준 상대 변환
    const absolute: Sim = { r: A.r * rel.r, d: vec(A.d.x + A.r * rel.d.x, A.d.y + A.r * rel.d.y) };
    const back = reanchor(A).sim(absolute);
    expect(back.r).toBeCloseTo(rel.r);
    close(back.d, rel.d);
  });
});

describe('이미지 교체 (§3.5)', () => {
  it('같은 내용의 다른 해상도로 교체해도 마커 화면 위치가 같다', () => {
    for (let i = 0; i < CASES; i++) {
      const v = randView(), s = randSim(), p = randVec();
      const oldW = between(500, 3000), newW = between(500, 3000);
      const rep = replaceImage(s, oldW, newW);
      close(worldToScreen(v, localToWorld(rep.sim, rep.local(p))), worldToScreen(v, localToWorld(s, p)));
      // 이미지 전체 폭이 월드에서 차지하는 길이도 같다
      expect(newW * rep.sim.r).toBeCloseTo(oldW * s.r);
    }
  });
});
