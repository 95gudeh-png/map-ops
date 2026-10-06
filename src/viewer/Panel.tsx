/**
 * 사용 화면의 지도 패널 하나(명세서 §4.2).
 * 뷰 변환과 십자선 위치는 상위(ViewerView)가 공유 참조로 가지며, 패널은 paint 함수를 등록해
 * 팬·줌·hover·그리기 중에 DOM transform만 직접 갱신한다(§8).
 *
 * 입력
 * - 왼쪽 버튼: 보기 모드 = 클릭(위치 확인)/드래그(이동), 펜 = 그리기, 지우개 = 문지른 획 삭제
 * - 오른쪽·가운데 버튼 드래그: 모든 모드에서 화면 이동
 * - 휠: 확대
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { composeToScreen, screenToWorld, vec, worldToLocal, worldToScreen, type Size, type Vec, type View } from '../geometry';
import { markerOnFloor, markerWorld } from '../mapOps';
import { MARKER_TYPES, markerColor, type Floor, type GameMap, type Id, type Marker, type Stroke } from '../model';
import type { RemoteProbe } from '../share/session';
import { FloorImg, simToCss } from '../ui/FloorImg';
import { hitStroke, simplify, strokePath } from './drawOps';

export type Painter = () => void;

export interface PanelShared {
  view: MutableRefObject<View | null>;
  /** 표시할 십자선 위치(hover 우선, 없으면 probe). */
  cross: MutableRefObject<Vec | null>;
}

export type Tool = 'view' | 'pen' | 'eraser';

export interface PenSettings {
  color: string;
  /** 화면 기준 굵기(px). */
  width: number;
}

interface Props {
  map: GameMap;
  floor: Floor;
  ghost?: Floor;
  shared: PanelShared;
  showLabels: boolean;
  showDrawings: boolean;
  selectedMarkerId: Id | null;
  tool: Tool;
  pen: PenSettings;
  registerPainter: (p: Painter) => () => void;
  onResize: (size: Size) => void;
  onPan: (delta: Vec) => void;
  onZoom: (cursor: Vec, zoomIn: boolean) => void;
  onProbe: (w: Vec, floorId: Id) => void;
  onHoverMarker: (w: Vec | null) => void;
  onMarkerClick: (m: Marker, floorId: Id) => void;
  /** 획 완성: 층 로컬 좌표와 층 로컬 굵기. */
  onStrokeDone: (floorId: Id, points: Vec[], width: number, color: string) => void;
  onEraseStroke: (id: Id) => void;
  /** 공유 상대의 선택 위치. */
  remoteProbes: RemoteProbe[];
}

const CLICK_THRESHOLD = 4;
/** 지우개 반경(화면 px). */
const ERASER_RADIUS = 8;

type Drag =
  | { kind: 'view'; start: Vec; last: Vec; moved: boolean; id: number }
  | { kind: 'pan'; last: Vec; id: number }
  | { kind: 'pen'; points: Vec[]; perPx: number; id: number } // points: 층 로컬 좌표
  | { kind: 'eraser'; erased: Set<Id>; id: number };

export const Panel = memo(function Panel(p: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgEl = useRef<HTMLImageElement | null>(null);
  const ghostEl = useRef<HTMLImageElement | null>(null);
  const crossEl = useRef<HTMLDivElement>(null);
  const drawGroup = useRef<SVGGElement>(null);
  const livePath = useRef<SVGPathElement>(null);
  const markerEls = useRef(new Map<Id, HTMLElement>());
  const remoteEls = useRef(new Map<number, HTMLElement>());

  const markers = p.map.markers.filter((m) => markerOnFloor(m, p.floor.id));
  const strokes: Stroke[] = (p.map.strokes ?? []).filter((s) => s.floorId === p.floor.id);
  const positions = useRef(new Map<Id, Vec>());
  positions.current = new Map(
    markers.flatMap((m) => {
      const w = markerWorld(p.map, m);
      return w ? [[m.id, w] as const] : [];
    }),
  );

  // 최신 props를 paint·이벤트에서 읽기 위한 참조
  const latest = useRef({ ...p, strokes });
  latest.current = { ...p, strokes };

  const paint = useCallback(() => {
    const { shared, floor, ghost } = latest.current;
    const v = shared.view.current;
    if (!v) return;
    const floorScreen = simToCss(composeToScreen(v, floor.sim));
    if (imgEl.current) imgEl.current.style.transform = floorScreen;
    if (drawGroup.current) drawGroup.current.setAttribute('transform', floorScreen);
    if (ghostEl.current && ghost) ghostEl.current.style.transform = simToCss(composeToScreen(v, ghost.sim));
    for (const [id, el] of markerEls.current) {
      const w = positions.current.get(id);
      if (!w) continue;
      const s = worldToScreen(v, w);
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
    for (const rp of latest.current.remoteProbes) {
      const el = remoteEls.current.get(rp.clientId);
      if (!el) continue;
      const s = worldToScreen(v, rp.w);
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
    const c = shared.cross.current;
    if (crossEl.current) {
      if (c) {
        const s = worldToScreen(v, c);
        crossEl.current.style.display = 'block';
        crossEl.current.style.transform = `translate(${s.x}px, ${s.y}px)`;
      } else crossEl.current.style.display = 'none';
    }
  }, []);

  const registerImg = useCallback(
    (el: HTMLImageElement | null) => {
      imgEl.current = el;
      paint();
    },
    [paint],
  );
  const registerGhost = useCallback(
    (el: HTMLImageElement | null) => {
      ghostEl.current = el;
      paint();
    },
    [paint],
  );

  useEffect(() => p.registerPainter(paint), [p.registerPainter, paint]);
  useLayoutEffect(() => paint());

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const report = () => {
      latest.current.onResize({ w: el.clientWidth, h: el.clientHeight });
      paint();
    };
    // 첫 측정은 즉시(ResizeObserver는 다음 렌더 프레임까지 늦을 수 있음)
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paint]);

  const local = (e: { clientX: number; clientY: number }): Vec => {
    const r = stageRef.current!.getBoundingClientRect();
    return vec(e.clientX - r.left, e.clientY - r.top);
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // 휠·Ctrl+휠 모두 줌, 브라우저 줌 차단
      const delta = e.deltaY || e.deltaX;
      if (delta) latest.current.onZoom(local(e), delta < 0);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** 화면 점 → 이 층 이미지 픽셀, 그리고 화면 1px이 층 픽셀로 몇인지. */
  const toFloor = (screen: Vec): { pt: Vec; perPx: number } | null => {
    const v = latest.current.shared.view.current;
    if (!v) return null;
    const s = latest.current.floor.sim;
    return { pt: worldToLocal(s, screenToWorld(v, screen)), perPx: 1 / (v.z * s.r) };
  };

  const eraseAt = (screen: Vec, erased: Set<Id>) => {
    const f = toFloor(screen);
    if (!f) return;
    const id = hitStroke(latest.current.strokes.filter((s) => !erased.has(s.id)), f.pt, ERASER_RADIUS * f.perPx);
    if (id) {
      erased.add(id);
      latest.current.onEraseStroke(id);
    }
  };

  const drag = useRef<Drag | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const pt = local(e);
    const id = e.pointerId;
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      drag.current = { kind: 'pan', last: pt, id };
    } else if (e.button === 0) {
      const tool = latest.current.tool;
      if (tool === 'pen') {
        const f = toFloor(pt);
        if (!f) return;
        drag.current = { kind: 'pen', points: [f.pt], perPx: f.perPx, id };
        const path = livePath.current;
        if (path) {
          path.setAttribute('stroke', latest.current.pen.color);
          path.setAttribute('stroke-width', String(latest.current.pen.width * f.perPx));
          path.setAttribute('d', strokePath([f.pt.x, f.pt.y]));
        }
      } else if (tool === 'eraser') {
        const d: Drag = { kind: 'eraser', erased: new Set(), id };
        drag.current = d;
        eraseAt(pt, d.erased);
      } else {
        drag.current = { kind: 'view', start: pt, last: pt, moved: false, id };
      }
    } else return;
    try {
      e.currentTarget.setPointerCapture(id);
    } catch {
      /* 이미 끝난 포인터(빠른 탭 등) — 캡처 없이 진행 */
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const pt = local(e);
    switch (d.kind) {
      case 'pan':
        p.onPan(vec(pt.x - d.last.x, pt.y - d.last.y));
        d.last = pt;
        stageRef.current?.classList.add('panning');
        break;
      case 'view':
        if (!d.moved && Math.hypot(pt.x - d.start.x, pt.y - d.start.y) > CLICK_THRESHOLD) {
          d.moved = true;
          stageRef.current?.classList.add('panning');
          p.onPan(vec(pt.x - d.start.x, pt.y - d.start.y));
        } else if (d.moved) p.onPan(vec(pt.x - d.last.x, pt.y - d.last.y));
        d.last = pt;
        break;
      case 'pen': {
        const f = toFloor(pt);
        if (!f) break;
        d.points.push(f.pt);
        livePath.current?.setAttribute('d', strokePath(d.points.flatMap((q) => [q.x, q.y])));
        break;
      }
      case 'eraser':
        eraseAt(pt, d.erased);
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    stageRef.current?.classList.remove('panning');
    if (d.kind === 'view' && !d.moved) {
      const v = p.shared.view.current;
      if (v) p.onProbe(screenToWorld(v, d.start), p.floor.id);
    } else if (d.kind === 'pen') {
      livePath.current?.setAttribute('d', '');
      // 화면 1.5px보다 가까운 점은 버려 저장량을 줄인다
      const { pen, floor } = latest.current;
      p.onStrokeDone(floor.id, simplify(d.points, 1.5 * d.perPx), pen.width * d.perPx, pen.color);
    }
  };

  const drawing = p.tool !== 'view';
  const colorOf = (m: Marker) => markerColor(p.map.markerStyle, m.type);

  return (
    <div
      ref={stageRef}
      className={`view-stage ${drawing ? `drawing tool-${p.tool}` : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        livePath.current?.setAttribute('d', '');
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <FloorImg floor={p.floor} register={registerImg} />
      {p.ghost && <FloorImg floor={p.ghost} register={registerGhost} className="ghost" />}
      <svg className="draw-layer" aria-hidden style={{ display: p.showDrawings || drawing ? undefined : 'none' }}>
        <g ref={drawGroup}>
          {strokes.map((s) => (
            <path key={s.id} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.width} />
          ))}
          <path ref={livePath} d="" />
        </g>
      </svg>
      <div className="marker-layer">
        {markers.map((m) => (
          <button
            key={m.id}
            ref={(el) => {
              if (el) markerEls.current.set(m.id, el);
              else markerEls.current.delete(m.id);
            }}
            className={`marker ${m.scope.kind} ${p.selectedMarkerId === m.id ? 'selected' : ''}`}
            style={{ ['--mk' as string]: colorOf(m) }}
            title={`${m.label || MARKER_TYPES[m.type].label} (${MARKER_TYPES[m.type].label}${m.scope.kind === 'through' ? ' · 관통' : ''})`}
            aria-label={m.label || MARKER_TYPES[m.type].label}
            tabIndex={drawing ? -1 : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => p.onHoverMarker(positions.current.get(m.id) ?? null)}
            onPointerLeave={() => p.onHoverMarker(null)}
            onClick={(e) => {
              e.stopPropagation();
              p.onMarkerClick(m, p.floor.id);
            }}
          >
            <span className="marker-dot" />
            {p.showLabels && m.label && <span className="marker-label">{m.label}</span>}
          </button>
        ))}
      </div>
      {p.remoteProbes.map((rp) => (
        <div
          key={rp.clientId}
          ref={(el) => {
            if (el) remoteEls.current.set(rp.clientId, el);
            else remoteEls.current.delete(rp.clientId);
          }}
          className="remote-cross"
          style={{ ['--rc' as string]: rp.user.color }}
          aria-hidden
        >
          <span className="h" />
          <span className="v" />
          <span className="who">{rp.user.name}</span>
        </div>
      ))}
      <div ref={crossEl} className="crosshair" aria-hidden>
        <span className="h" />
        <span className="v" />
      </div>
    </div>
  );
});
