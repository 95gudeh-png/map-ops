/**
 * 마법사 3단계: 정렬/배율 (명세서 §3.4, §4.3).
 *
 * 연속 입력(드래그·휠·방향키) 중에는 React 상태를 건드리지 않고 live 참조와 DOM transform만
 * 직접 갱신한다(§8). 입력이 끝나면 onChange로 초안에 커밋한다.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  composeToScreen,
  dragFloor,
  fitView,
  floorWorldRect,
  panView,
  scaleFloorAt,
  SCALE_STEP,
  SCALE_STEP_FINE,
  unionRect,
  vec,
  zoomViewAt,
  type Rect,
  type Sim,
  type Size,
  type Vec,
  type View,
} from '../geometry';
import type { Floor, GameMap, Id } from '../model';
import { FloorImg, simToCss } from '../ui/FloorImg';
import { calibTargets, resetFloorPlacement } from './draft';

interface Props {
  draft: GameMap;
  onChange: (d: GameMap) => void;
  onBack: () => void;
  /** 마지막 커밋까지 반영된 초안을 넘긴다(부모 상태 갱신을 기다리지 않도록). */
  onFinish: (finalDraft: GameMap) => void;
  finishLabel: string;
}

type Phase = 'position' | 'scale';
interface Sub {
  index: number; // -1 = 3-0 기준층
  phase: Phase;
}

const VIEW_ZOOM_STEP = 1.15;
const COMMIT_DELAY = 200;

export function CalibrateStep({ draft, onChange, onBack, onFinish, finishLabel }: Props) {
  const targets = useMemo(() => calibTargets(draft), [draft]);
  const anchor = draft.floors.find((f) => f.id === draft.anchorFloorId)!;
  const [sub, setSub] = useState<Sub>({ index: -1, phase: 'position' });
  const [showGrid, setShowGrid] = useState(true);
  const [opacity, setOpacity] = useState(0.7);
  const [flash, setFlash] = useState<string | null>(null);

  const isAnchorStep = sub.index === -1;
  const target: Floor | undefined = isAnchorStep ? undefined : targets[sub.index];

  /* ---------- live 상태 ---------- */
  const sims = useRef(new Map<Id, Sim>());
  const view = useRef<View | null>(null);
  const fitZ = useRef(1);
  const stageSize = useRef<Size>({ w: 0, h: 0 });
  const gridFrame = useRef<Rect | null>(null);
  const tileSize = useRef<Size>({ w: 0, h: 0 });
  const stageEls = useRef(new Map<Id, HTMLImageElement>());
  const tileEls = useRef(new Map<Id, HTMLImageElement>());
  const percentEl = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const commitTimer = useRef<number | undefined>(undefined);

  // 최신 props/상태를 이벤트 핸들러에서 읽기 위한 참조
  const latest = useRef({ draft, target, sub, onChange });
  latest.current = { draft, target, sub, onChange };

  const paint = useCallback(() => {
    const v = view.current;
    if (v) {
      for (const [id, el] of stageEls.current) {
        const s = sims.current.get(id);
        if (s) el.style.transform = simToCss(composeToScreen(v, s));
      }
    }
    const frame = gridFrame.current;
    if (frame && tileSize.current.w > 0) {
      const gv = fitView(frame, tileSize.current, 1);
      for (const [id, el] of tileEls.current) {
        const s = sims.current.get(id);
        if (s) el.style.transform = simToCss(composeToScreen(gv, s));
      }
    }
    const t = latest.current.target;
    if (percentEl.current) {
      const s = t && sims.current.get(t.id);
      percentEl.current.textContent = s && t ? `${Math.round((s.r / t.r0) * 100)}%` : '';
    }
  }, []);

  // 초안이 바뀌면(커밋·초기화·외부 변경) live 값을 맞춘다
  useLayoutEffect(() => {
    sims.current = new Map(draft.floors.map((f) => [f.id, f.sim]));
    paint();
  }, [draft, paint]);

  /** live 값을 초안에 반영하고, 반영된(또는 그대로인) 최신 초안을 돌려준다. */
  const commit = useCallback((): GameMap => {
    window.clearTimeout(commitTimer.current);
    const { draft: d, onChange: change } = latest.current;
    if (!dirty.current) return d;
    dirty.current = false;
    const next = { ...d, floors: d.floors.map((f) => ({ ...f, sim: sims.current.get(f.id) ?? f.sim })) };
    latest.current.draft = next;
    change(next);
    return next;
  }, []);
  const commitSoon = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(commit, COMMIT_DELAY);
  }, [commit]);
  useEffect(
    () => () => {
      commit();
    },
    [commit],
  ); // 단계 이탈 시 남은 변경 저장

  const fitToAnchor = useCallback(() => {
    const a = latest.current.draft.floors.find((f) => f.id === latest.current.draft.anchorFloorId);
    if (!a || stageSize.current.w === 0) return;
    view.current = fitView(floorWorldRect(sims.current.get(a.id) ?? a.sim, { w: a.imageW, h: a.imageH }), stageSize.current);
    fitZ.current = view.current.z;
    paint();
  }, [paint]);

  const refitGrid = useCallback(() => {
    const d = latest.current.draft;
    gridFrame.current = unionRect(
      d.floors.map((f) => floorWorldRect(sims.current.get(f.id) ?? f.sim, { w: f.imageW, h: f.imageH })),
    );
    if (gridFrame.current) {
      // ×0.92 여백(§4.3): 프레임 자체를 넓혀 둔다
      const fr = gridFrame.current;
      const k = 1 / 0.92;
      gridFrame.current = { x: fr.x - (fr.w * (k - 1)) / 2, y: fr.y - (fr.h * (k - 1)) / 2, w: fr.w * k, h: fr.h * k };
    }
    paint();
  }, [paint]);

  // 격자 프레임은 이 단계 진입 시 1회 계산(§8)
  useLayoutEffect(() => {
    refitGrid();
  }, [refitGrid]);

  /* ---------- 크기 관찰 ---------- */
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      stageSize.current = { w: el.clientWidth, h: el.clientHeight };
      if (!view.current) fitToAnchor();
      else paint();
    };
    measure(); // 첫 측정은 즉시
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToAnchor, paint]);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const tile = el.querySelector<HTMLElement>('.grid-tile');
      if (tile) tileSize.current = { w: tile.clientWidth, h: tile.clientHeight };
      paint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showGrid, paint]);

  /* ---------- 입력 ---------- */
  const showFlash = (text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash((f) => (f === text ? null : f)), 1800);
  };

  const localPoint = (e: { clientX: number; clientY: number }): Vec => {
    const r = stageRef.current!.getBoundingClientRect();
    return vec(e.clientX - r.left, e.clientY - r.top);
  };

  // 휠은 passive:false로 직접 등록해야 브라우저 줌(Ctrl+휠)을 막을 수 있다
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      if (!v) return;
      const delta = e.deltaY || e.deltaX; // Shift+휠은 가로 스크롤로 오는 브라우저가 있음
      if (delta === 0) return;
      const up = delta < 0;
      const cursor = localPoint(e);
      const { target: t, sub: s } = latest.current;

      if (e.ctrlKey && t) {
        if (s.phase === 'position') {
          showFlash('배율은 다음 단계(3-2)에서 조정하오.');
          return;
        }
        const base = e.shiftKey ? SCALE_STEP_FINE : SCALE_STEP;
        const cur = sims.current.get(t.id)!;
        sims.current.set(t.id, scaleFloorAt(cur, cursor, v, up ? base : 1 / base, t.r0));
        dirty.current = true;
        paint();
        commitSoon();
        return;
      }
      view.current = zoomViewAt(v, cursor, up ? VIEW_ZOOM_STEP : 1 / VIEW_ZOOM_STEP, fitZ.current * 0.2, fitZ.current * 20);
      paint();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [paint, commitSoon]);

  const drag = useRef<{ last: Vec; mode: 'pan' | 'floor'; id: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    stageRef.current?.focus();
    // 오른쪽/가운데 버튼 또는 3-0은 화면 이동, 3-1/3-2의 왼쪽 버튼은 층 이동
    const mode = e.button !== 0 || !target ? 'pan' : 'floor';
    drag.current = { last: localPoint(e), mode, id: e.pointerId };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 이미 끝난 포인터 — 캡처 없이 진행 */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !view.current) return;
    const p = localPoint(e);
    const delta = vec(p.x - d.last.x, p.y - d.last.y);
    d.last = p;
    if (d.mode === 'pan') view.current = panView(view.current, delta);
    else if (target) {
      sims.current.set(target.id, dragFloor(sims.current.get(target.id)!, delta, view.current));
      dirty.current = true;
    }
    paint();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    commit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dirs: Record<string, Vec> = { ArrowLeft: vec(-1, 0), ArrowRight: vec(1, 0), ArrowUp: vec(0, -1), ArrowDown: vec(0, 1) };
    const dir = dirs[e.key];
    if (!dir || !view.current) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const delta = vec(dir.x * step, dir.y * step);
    if (target) {
      sims.current.set(target.id, dragFloor(sims.current.get(target.id)!, delta, view.current));
      dirty.current = true;
      commitSoon();
    } else {
      view.current = panView(view.current, delta);
    }
    paint();
  };

  /* ---------- 단계 이동 ---------- */
  const go = (next: Sub) => {
    commit();
    setSub(next);
  };
  const back = () => {
    if (isAnchorStep) {
      commit();
      return onBack();
    }
    if (sub.phase === 'scale') return go({ index: sub.index, phase: 'position' });
    if (sub.index > 0) return go({ index: sub.index - 1, phase: 'scale' });
    go({ index: -1, phase: 'position' });
  };
  const isLast = !isAnchorStep && sub.phase === 'scale' && sub.index === targets.length - 1;
  const next = () => {
    if (isAnchorStep) return go({ index: 0, phase: 'position' });
    if (sub.phase === 'position') return go({ index: sub.index, phase: 'scale' });
    if (!isLast) return go({ index: sub.index + 1, phase: 'position' });
    onFinish(commit());
  };
  const reset = () => {
    if (target) {
      commit();
      onChange(resetFloorPlacement(latest.current.draft, target.id));
    } else fitToAnchor();
  };

  // 단계가 바뀌면 percent 표시 갱신
  useLayoutEffect(() => paint(), [sub, paint]);

  const registerStage = useCallback(
    (id: Id) => (el: HTMLImageElement | null) => {
      if (el) {
        stageEls.current.set(id, el);
        paint();
      } else stageEls.current.delete(id);
    },
    [paint],
  );
  const registerTile = useCallback(
    (id: Id) => (el: HTMLImageElement | null) => {
      if (el) {
        tileEls.current.set(id, el);
        paint();
      } else tileEls.current.delete(id);
    },
    [paint],
  );
  // register 콜백을 층별로 고정해 FloorImg(memo) 재렌더를 막는다
  const stageRegs = useMemo(() => new Map<Id, (el: HTMLImageElement | null) => void>(), []);
  const tileRegs = useMemo(() => new Map<Id, (el: HTMLImageElement | null) => void>(), []);
  const regStage = (id: Id) => {
    if (!stageRegs.has(id)) stageRegs.set(id, registerStage(id));
    return stageRegs.get(id)!;
  };
  const regTile = (id: Id) => {
    if (!tileRegs.has(id)) tileRegs.set(id, registerTile(id));
    return tileRegs.get(id)!;
  };

  /* ---------- 표시 ---------- */
  const title = isAnchorStep ? '3-0. 기준층(★) 확인' : sub.phase === 'position' ? '3-1. 위치 맞추기' : '3-2. 배율 맞추기';
  const note = isAnchorStep
    ? `${anchor.name}은(는) 전체 좌표의 기준층이오. 끌어서 이동, 휠로 확대해 전체가 잘 보이게 두시오. 이 화면 배율은 다음 단계에서도 유지되니, 맞출 부분을 크게 확대해 두면 정밀하게 맞출 수 있소.`
    : sub.phase === 'position'
      ? `${target!.name}을(를) 끌어서 기준층(흐리게 표시)과 같은 물리적 지점(계단, 벽 모서리 등)이 겹치도록 위치만 맞추시오. 방향키로 1px, Shift+방향키로 10px씩 움직이오.`
      : `Ctrl+휠로 ${target!.name}의 크기를 맞추시오(Shift를 함께 누르면 미세 조정). 끌어서 위치도 함께 다듬을 수 있소.`;
  const progress = isAnchorStep ? '' : `${sub.index + 1}/${targets.length}`;

  return (
    <div className="wizard-step">
      <div className="calib-head">
        <div>
          <h3>{title}</h3>
          <p className="step-note">{note}</p>
        </div>
        {!isAnchorStep && (
          <div className="calib-status">
            <div>
              <b>{target!.name}</b> → ★{anchor.name} · {progress}
            </div>
            <div className="dim">
              배율 <span ref={percentEl} />
            </div>
          </div>
        )}
      </div>

      <div
        ref={stageRef}
        className={`calib-stage ${target ? 'floor-mode' : 'pan-mode'}`}
        tabIndex={0}
        aria-label="정렬 화면"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
      >
        <FloorImg key={`s-${anchor.id}`} floor={anchor} register={regStage(anchor.id)} style={{ opacity: target ? 0.4 : 1 }} />
        {target && (
          <FloorImg key={`s-${target.id}`} floor={target} register={regStage(target.id)} className="calib-target" style={{ opacity }} />
        )}
        {flash && <div className="stage-flash">{flash}</div>}
        <div className="stage-help">
          {target ? '왼쪽 끌기: 층 이동 · 오른쪽 끌기: 화면 이동 · 휠: 확대' : '끌기: 화면 이동 · 휠: 확대'}
          {target && sub.phase === 'scale' ? ' · Ctrl+휠: 배율' : ''}
        </div>
      </div>

      <div className="calib-tools">
        {target && (
          <label className="opacity-ctl">
            맞추는 층 불투명도
            <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
        )}
        <button className="btn small ghost" onClick={reset}>
          {target ? '이 층 위치/크기 초기화' : '화면 맞춤'}
        </button>
        {target && (
          <button className="btn small ghost" onClick={fitToAnchor}>
            화면 맞춤
          </button>
        )}
        <span className="spacer" />
        <button className="btn small" onClick={() => setShowGrid((v) => !v)} aria-pressed={showGrid}>
          ⊞ 전체 층 비교 {showGrid ? '닫기' : '열기'}
        </button>
        {showGrid && (
          <button className="btn small ghost" onClick={refitGrid} title="층이 칸 밖으로 벗어났을 때 다시 맞춤">
            ↻ 격자 화면 재조정
          </button>
        )}
      </div>

      {showGrid && (
        <>
          <p className="hint">
            모든 층을 같은 프레임으로 나란히 보여주오. 같은 물리적 지점이 각 칸의 같은 자리에 있으면 정렬이 맞은 것이오. 프레임은 이
            단계에 들어올 때 한 번 고정되니, 크게 벗어나면 "격자 화면 재조정"을 누르시오.
          </p>
          <div ref={gridRef} className="compare-grid">
            {draft.floors.map((f) => (
              <div key={f.id} className={`grid-tile ${target?.id === f.id ? 'current' : ''}`}>
                <FloorImg floor={f} register={regTile(f.id)} />
                <span className="tile-label">
                  {f.name}
                  {f.id === draft.anchorFloorId ? ' ★' : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="wizard-actions">
        <button className="btn ghost" onClick={back}>
          {isAnchorStep ? '이전: 층 업로드' : sub.phase === 'scale' ? '이전: 위치' : '이전'}
        </button>
        <button className="btn primary" onClick={next}>
          {isAnchorStep ? '다음: 층 맞추기' : sub.phase === 'position' ? '다음: 배율' : isLast ? finishLabel : '다음 층'}
        </button>
      </div>
    </div>
  );
}
