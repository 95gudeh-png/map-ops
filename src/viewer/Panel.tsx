/**
 * 사용 화면의 지도 패널 하나(명세서 §4.2).
 * 뷰 변환과 십자선 위치는 상위(ViewerView)가 공유 참조로 가지며, 패널은 paint 함수를 등록해
 * 팬·줌·hover 중에 DOM transform만 직접 갱신한다(§8).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { composeToScreen, screenToWorld, vec, worldToScreen, type Size, type Vec, type View } from '../geometry';
import { markerOnFloor, markerWorld } from '../mapOps';
import { MARKER_TYPES, type Floor, type GameMap, type Id, type Marker } from '../model';
import { FloorImg, simToCss } from '../ui/FloorImg';

export type Painter = () => void;

export interface PanelShared {
  view: MutableRefObject<View | null>;
  /** 표시할 십자선 위치(hover 우선, 없으면 probe). */
  cross: MutableRefObject<Vec | null>;
}

interface Props {
  map: GameMap;
  floor: Floor;
  ghost?: Floor;
  shared: PanelShared;
  showLabels: boolean;
  selectedMarkerId: Id | null;
  registerPainter: (p: Painter) => () => void;
  onResize: (size: Size) => void;
  onPan: (delta: Vec) => void;
  onZoom: (cursor: Vec, zoomIn: boolean) => void;
  onProbe: (w: Vec, floorId: Id) => void;
  onHoverMarker: (w: Vec | null) => void;
  onMarkerClick: (m: Marker, floorId: Id) => void;
}

const CLICK_THRESHOLD = 4;

export const Panel = memo(function Panel(p: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgEl = useRef<HTMLImageElement | null>(null);
  const ghostEl = useRef<HTMLImageElement | null>(null);
  const crossEl = useRef<HTMLDivElement>(null);
  const markerEls = useRef(new Map<Id, HTMLElement>());

  const markers = p.map.markers.filter((m) => markerOnFloor(m, p.floor.id));
  const positions = useRef(new Map<Id, Vec>());
  positions.current = new Map(
    markers.flatMap((m) => {
      const w = markerWorld(p.map, m);
      return w ? [[m.id, w] as const] : [];
    }),
  );

  // 최신 props를 paint에서 읽기 위한 참조
  const latest = useRef(p);
  latest.current = p;

  const paint = useCallback(() => {
    const { shared, floor, ghost } = latest.current;
    const v = shared.view.current;
    if (!v) return;
    if (imgEl.current) imgEl.current.style.transform = simToCss(composeToScreen(v, floor.sim));
    if (ghostEl.current && ghost) ghostEl.current.style.transform = simToCss(composeToScreen(v, ghost.sim));
    for (const [id, el] of markerEls.current) {
      const w = positions.current.get(id);
      if (!w) continue;
      const s = worldToScreen(v, w);
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
    const ro = new ResizeObserver(() => {
      latest.current.onResize({ w: el.clientWidth, h: el.clientHeight });
      paint();
    });
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

  const drag = useRef<{ start: Vec; last: Vec; moved: boolean; id: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = local(e);
    drag.current = { start: pt, last: pt, moved: false, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const pt = local(e);
    if (!d.moved && Math.hypot(pt.x - d.start.x, pt.y - d.start.y) > CLICK_THRESHOLD) {
      d.moved = true;
      stageRef.current?.classList.add('panning');
      p.onPan(vec(pt.x - d.start.x, pt.y - d.start.y));
    } else if (d.moved) p.onPan(vec(pt.x - d.last.x, pt.y - d.last.y));
    d.last = pt;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    stageRef.current?.classList.remove('panning');
    const v = p.shared.view.current;
    if (!d.moved && v) p.onProbe(screenToWorld(v, d.start), p.floor.id);
  };

  return (
    <div
      ref={stageRef}
      className="view-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
    >
      <FloorImg floor={p.floor} register={registerImg} />
      {p.ghost && <FloorImg floor={p.ghost} register={registerGhost} className="ghost" />}
      <div className="marker-layer">
        {markers.map((m) => (
          <button
            key={m.id}
            ref={(el) => {
              if (el) markerEls.current.set(m.id, el);
              else markerEls.current.delete(m.id);
            }}
            className={`marker ${m.scope.kind} ${p.selectedMarkerId === m.id ? 'selected' : ''}`}
            style={{ ['--mk' as string]: MARKER_TYPES[m.type].color }}
            title={`${m.label || MARKER_TYPES[m.type].label} (${MARKER_TYPES[m.type].label}${m.scope.kind === 'through' ? ' · 관통' : ''})`}
            aria-label={m.label || MARKER_TYPES[m.type].label}
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
      <div ref={crossEl} className="crosshair" aria-hidden>
        <span className="h" />
        <span className="v" />
      </div>
    </div>
  );
});
