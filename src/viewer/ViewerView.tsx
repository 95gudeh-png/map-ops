/** 사용 화면(명세서 §3.6, §4.2). */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fitView, floorWorldRect, panView, zoomViewAt, type Size, type Vec, type View } from '../geometry';
import { markerWorld } from '../mapOps';
import { DEFAULT_MARKER_STYLE, newId, type GameMap, type Id, type Marker, type MarkerStyle } from '../model';
import { SharePanel } from '../share/SharePanel';
import { shareManager, useRemoteProbes, useShareState } from '../share/shareManager';
import { repo } from '../store/repo';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { loadCrosshair, loadCursorGuide, saveCrosshair, saveCursorGuide, type CrosshairSettings, type CursorGuideSettings } from './crosshair';
import { CursorGuidePanel } from './CursorGuidePanel';
import { addStroke, clearFloorStrokes, deleteStroke, flatten, PEN_COLORS, PEN_WIDTHS, strokesOnFloor } from './drawOps';
import { DrawToolbar } from './DrawToolbar';
import { MarkerForm } from './MarkerForm';
import { addMarker, deleteMarker, moveMarker, updateMarker, type MarkerInput } from './markerOps';
import { MarkerStylePanel } from './MarkerStylePanel';
import { Panel, type Painter, type PanelShared, type PenSettings, type Tool } from './Panel';
import { Sidebar } from './Sidebar';

/* ---------- 기기별 그리기 설정 ---------- */
const PEN_KEY = 'mapops.pen';
const SHOW_DRAWINGS_KEY = 'mapops.showDrawings';
function loadPen(): PenSettings {
  try {
    const v = JSON.parse(localStorage.getItem(PEN_KEY) ?? 'null') as PenSettings | null;
    if (v && /^#[0-9a-f]{6}$/i.test(v.color) && PEN_WIDTHS.includes(v.width)) return v;
  } catch {
    /* 무시 */
  }
  return { color: PEN_COLORS[0]!, width: PEN_WIDTHS[1]! };
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 불가 — 이번에만 적용 */
  }
}
function loadShowDrawings(): boolean {
  try {
    return localStorage.getItem(SHOW_DRAWINGS_KEY) !== 'false';
  } catch {
    return true;
  }
}

const STYLE_SAVE_DELAY = 300;
const OUTLINE_COLORS = { dark: '#0c0e12', light: '#ffffff', none: 'transparent' } as const;

interface Props {
  map: GameMap;
  onEditMap: () => void;
}

const ZOOM_STEP = 1.15;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 8;

type Form = { mode: 'add'; w: Vec; floorId: Id } | { mode: 'edit'; marker: Marker };

export function ViewerView({ map, onEditMap }: Props) {
  const firstId = map.floors[0]?.id ?? '';
  const [activeFloor, setActiveFloor] = useState<Id>(firstId);
  const [split, setSplit] = useState(false);
  const [floorA, setFloorA] = useState<Id>(firstId);
  const [floorB, setFloorB] = useState<Id>(map.floors[1]?.id ?? firstId);
  const [ghost, setGhost] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [probe, setProbe] = useState<{ w: Vec; floorId: Id } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [moving, setMoving] = useState<Marker | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Marker | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crosshair, setCrosshair] = useState<CrosshairSettings>(loadCrosshair);
  const [guide, setGuide] = useState<CursorGuideSettings>(loadCursorGuide);
  const [selectedMarker, setSelectedMarker] = useState<Id | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const shareState = useShareState(map.id);
  const remoteProbes = useRemoteProbes(map.id);
  const [tool, setTool] = useState<Tool>('view');
  const [pen, setPen] = useState<PenSettings>(loadPen);
  const [showDrawings, setShowDrawings] = useState(loadShowDrawings);
  const [confirmClear, setConfirmClear] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('mapops.sidebar') !== 'false';
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    setSidebarOpen((v) => {
      savePref('mapops.sidebar', !v);
      return !v;
    });
  };
  const [liveStyle, setLiveStyle] = useState<MarkerStyle>(map.markerStyle ?? DEFAULT_MARKER_STYLE);
  /** 이 기기에서 그린 획(되돌리기용, 최근 것이 끝). */
  const myStrokes = useRef<Id[]>([]);
  const [undoCount, setUndoCount] = useState(0);

  // 층이 삭제·변경돼도 유효한 층을 가리키도록
  const valid = (id: Id) => (map.floors.some((f) => f.id === id) ? id : firstId);
  const curFloor = valid(activeFloor);
  const curA = valid(floorA);
  const curB = valid(floorB);

  /* ---------- 공유 뷰·십자선 ---------- */
  const view = useRef<View | null>(null);
  const cross = useRef<Vec | null>(null);
  const cursor = useRef<Vec | null>(null);
  const hover = useRef<Vec | null>(null);
  const fitZ = useRef(1);
  const panelSize = useRef<Size>({ w: 0, h: 0 });
  const painters = useRef(new Set<Painter>());
  const shared = useMemo<PanelShared>(() => ({ view, cross, cursor }), []);
  const probeRef = useRef(probe);
  probeRef.current = probe;

  const paintAll = useCallback(() => {
    cross.current = hover.current ?? probeRef.current?.w ?? null;
    for (const p of painters.current) p.paint();
  }, []);

  // 마우스 이동은 매우 잦으므로 화면 갱신 주기(rAF)에 한 번만 커서 가이드를 다시 그린다
  const cursorFrame = useRef(0);
  const onCursor = useCallback((w: Vec | null) => {
    cursor.current = w;
    if (cursorFrame.current) return;
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = 0;
      for (const p of painters.current) p.paintCursor();
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(cursorFrame.current), []);
  const registerPainter = useCallback((p: Painter) => {
    painters.current.add(p);
    return () => void painters.current.delete(p);
  }, []);

  const mapRef = useRef(map);
  mapRef.current = map;
  /**
   * 저장 직전의 최신 맵. 저장소 캐시는 쓰는 즉시 갱신되므로, 화면 재렌더 전에 연달아 저장해도
   * (빠른 연속 획, 지우개로 여러 획) 앞의 변경을 덮어쓰지 않는다.
   */
  const latestMap = useCallback(() => repo.getMap(mapRef.current.id) ?? mapRef.current, []);
  const fit = useCallback(() => {
    const m = mapRef.current;
    const anchor = m.floors.find((f) => f.id === m.anchorFloorId) ?? m.floors[0];
    if (!anchor || panelSize.current.w === 0) return;
    view.current = fitView(floorWorldRect(anchor.sim, { w: anchor.imageW, h: anchor.imageH }), panelSize.current);
    fitZ.current = view.current.z;
    paintAll();
  }, [paintAll]);

  const onResize = useCallback(
    (size: Size) => {
      panelSize.current = size;
      if (!view.current) fit();
    },
    [fit],
  );
  const onPan = useCallback(
    (delta: Vec) => {
      if (!view.current) return;
      view.current = panView(view.current, delta);
      paintAll();
    },
    [paintAll],
  );
  const onZoom = useCallback(
    (cursor: Vec, zoomIn: boolean) => {
      if (!view.current) return;
      view.current = zoomViewAt(view.current, cursor, zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP, fitZ.current * ZOOM_MIN, fitZ.current * ZOOM_MAX);
      paintAll();
    },
    [paintAll],
  );
  const onHoverMarker = useCallback(
    (w: Vec | null) => {
      hover.current = w;
      paintAll();
    },
    [paintAll],
  );

  const movingRef = useRef(moving);
  movingRef.current = moving;
  const onProbe = useCallback((w: Vec, floorId: Id) => {
    const mv = movingRef.current;
    if (mv) {
      repo.saveMap(moveMarker(latestMap(), mv.id, w));
      setMoving(null);
      setSelectedMarker(mv.id);
      setProbe({ w, floorId });
      return;
    }
    setForm(null);
    setSelectedMarker(null);
    setProbe({ w, floorId });
  }, [latestMap]);

  /* ---------- 그리기 ---------- */
  const onStrokeDone = useCallback(
    (floorId: Id, points: Vec[], width: number, color: string) => {
      const id = newId();
      repo.saveMap(addStroke(latestMap(), { id, floorId, color, width, points: flatten(points), createdAt: Date.now() }));
      myStrokes.current.push(id);
      setUndoCount(myStrokes.current.length);
    },
    [latestMap],
  );
  const onEraseStroke = useCallback((id: Id) => repo.saveMap(deleteStroke(latestMap(), id)), [latestMap]);
  const undo = useCallback(() => {
    const m = latestMap();
    // 이미 지워진(지우개·친구) 획은 건너뛴다
    while (myStrokes.current.length) {
      const id = myStrokes.current.pop()!;
      if ((m.strokes ?? []).some((s) => s.id === id)) {
        repo.saveMap(deleteStroke(m, id));
        break;
      }
    }
    setUndoCount(myStrokes.current.length);
  }, [latestMap]);

  const changeTool = (t: Tool) => {
    setTool(t);
    if (t !== 'view') {
      setProbe(null);
      setForm(null);
      setMoving(null);
      setSettingsOpen(false);
    }
  };
  const changePen = (p: PenSettings) => {
    setPen(p);
    savePref(PEN_KEY, p);
  };
  const changeShowDrawings = (v: boolean) => {
    setShowDrawings(v);
    savePref(SHOW_DRAWINGS_KEY, v);
  };

  /* ---------- 마커 모양 ---------- */
  const styleTimer = useRef<number | undefined>(undefined);
  const styleDirty = useRef(false);
  // 저장 대기 중이 아닐 때만 다른 사람의 변경을 반영
  useEffect(() => {
    if (!styleDirty.current) setLiveStyle(map.markerStyle ?? DEFAULT_MARKER_STYLE);
  }, [map.markerStyle]);
  // 최신 값에 합친 결과를 참조로도 들고 있어야 연속 조작·지연 저장이 서로 덮어쓰지 않는다
  const liveStyleRef = useRef(liveStyle);
  liveStyleRef.current = liveStyle;
  const applyStyle = (next: MarkerStyle) => {
    liveStyleRef.current = next;
    setLiveStyle(next);
    styleDirty.current = true;
    window.clearTimeout(styleTimer.current);
    styleTimer.current = window.setTimeout(() => {
      styleDirty.current = false;
      repo.saveMap({ ...latestMap(), markerStyle: liveStyleRef.current });
    }, STYLE_SAVE_DELAY);
  };
  const changeStyle = (patch: Partial<MarkerStyle>) => {
    const prev = liveStyleRef.current;
    applyStyle({ ...prev, ...patch, colors: { ...prev.colors, ...patch.colors } });
  };
  const resetStyle = () => applyStyle(DEFAULT_MARKER_STYLE);
  useEffect(() => () => window.clearTimeout(styleTimer.current), []);
  const onMarkerClick = useCallback((m: Marker, floorId: Id) => {
    const w = markerWorld(mapRef.current, m);
    if (!w) return;
    setSelectedMarker(m.id);
    setProbe({ w, floorId });
  }, []);

  useEffect(() => paintAll(), [probe, paintAll]);
  // 내 선택 위치를 공유 상대에게 알림
  useEffect(() => shareManager.setProbe(map.id, probe), [map.id, probe, shareState.shared]);
  useEffect(() => () => shareManager.setProbe(map.id, null), [map.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, form')) return;
      if (tool !== 'view' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key !== 'Escape') return;
      if (tool !== 'view') setTool('view');
      else if (moving) setMoving(null);
      else if (form) setForm(null);
      else if (settingsOpen) setSettingsOpen(false);
      else {
        setProbe(null);
        setSelectedMarker(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moving, form, settingsOpen, tool, undo]);

  /* ---------- 마커 저장 ---------- */
  const submitForm = (input: MarkerInput) => {
    if (!form) return;
    if (form.mode === 'add') {
      const r = addMarker(latestMap(), input);
      repo.saveMap(r.map);
      setSelectedMarker(r.marker.id);
    } else {
      repo.saveMap(updateMarker(latestMap(), form.marker.id, input));
    }
    setForm(null);
  };

  // 연속 조작에서도 앞의 변경을 잃지 않도록 함수형 갱신으로 합친다
  const updateCrosshair = (patch: Partial<CrosshairSettings>) =>
    setCrosshair((prev) => {
      const next = { ...prev, ...patch };
      saveCrosshair(next);
      return next;
    });
  const updateGuide = (patch: Partial<CursorGuideSettings>) =>
    setGuide((prev) => {
      const next = { ...prev, ...patch };
      saveCursorGuide(next);
      return next;
    });

  /* ---------- 표시 ---------- */
  const floorById = (id: Id) => map.floors.find((f) => f.id === id)!;
  const idx = map.floors.findIndex((f) => f.id === curFloor);
  const ghostFloor = ghost && !split && idx > 0 ? map.floors[idx - 1] : undefined;
  const rootStyle = {
    '--ch-len': `${crosshair.length}px`,
    '--ch-thick': `${crosshair.thickness}px`,
    '--ch-color': crosshair.color,
    '--mk-scale': liveStyle.size,
    '--mk-opacity': liveStyle.opacity,
    '--mk-outline': OUTLINE_COLORS[liveStyle.outline],
    '--mk-label': `${liveStyle.labelSize}px`,
  } as CSSProperties;
  // 마커 색 미리보기를 위해 저장 전 설정을 덮어쓴 맵(바뀔 때만 새 객체 → Panel memo 유지)
  const shownMap = useMemo(() => ({ ...map, markerStyle: liveStyle }), [map, liveStyle]);
  const curStrokeCount = strokesOnFloor(map, curFloor).length;
  // 내가 그린 획 중 아직 남아 있는 것이 있을 때만 되돌리기 가능(지우개·친구가 지운 것 제외)
  const liveIds = new Set((map.strokes ?? []).map((s) => s.id));
  const canUndo = undoCount > 0 && myStrokes.current.some((id) => liveIds.has(id));

  const panelProps = {
    map: shownMap,
    shared,
    showLabels,
    showDrawings,
    tool,
    pen,
    onStrokeDone,
    onEraseStroke,
    onCursor,
    guide,
    selectedMarkerId: selectedMarker,
    registerPainter,
    onResize,
    onPan,
    onZoom,
    onProbe,
    onHoverMarker,
    onMarkerClick,
    remoteProbes,
  };

  const floorSelect = (value: Id, onChange: (id: Id) => void, label: string) => (
    <label className="panel-head">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {map.floors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );

  if (map.floors.length === 0) return <p className="dim">이 맵에는 층이 없소.</p>;

  return (
    <div className={`viewer ${moving ? 'moving' : ''} outline-${liveStyle.outline}`} style={rootStyle}>
      <div className="viewer-toolbar">
        <h2 className="map-title">{map.name}</h2>
        {!split && (
          <div className="floor-tabs" role="tablist" aria-label="층">
            {map.floors.map((f) => (
              <button key={f.id} role="tab" aria-selected={f.id === curFloor} className={`floor-tab ${f.id === curFloor ? 'active' : ''}`} onClick={() => setActiveFloor(f.id)}>
                {f.name}
                {f.id === map.anchorFloorId && <span className="anchor-mark" title="기준층"> ★</span>}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {!split && (
          <label className="check">
            <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />
            이전 층 겹쳐보기
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          마커 이름
        </label>
        <button className={`btn small ${split ? 'primary' : ''}`} onClick={() => setSplit((s) => !s)} disabled={map.floors.length < 2 && !split}>
          {split ? '단일 보기로' : '2단 비교'}
        </button>
        <button className="btn small" onClick={fit} title="확대/이동 초기화">
          ⤾ 보기 리셋
        </button>
        <button className={`btn small ${tool !== 'view' ? 'primary' : ''}`} onClick={() => changeTool(tool === 'view' ? 'pen' : 'view')} aria-pressed={tool !== 'view'}>
          ✏ 그리기
        </button>
        <button className="btn small" onClick={() => setStyleOpen((v) => !v)} aria-expanded={styleOpen}>
          마커 모양
        </button>
        <button
          className={`btn small ${guide.enabled ? 'guide-on' : ''}`}
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          title="마우스를 따라다니는 십자 가이드와 십자선 설정"
        >
          ⌖ 커서 가이드
        </button>
        <button className="btn small ghost" onClick={onEditMap}>
          맵 편집
        </button>
        {!split && (
          <button className="btn small ghost" onClick={toggleSidebar} aria-pressed={sidebarOpen} title="오른쪽 마커 목록 보이기/숨기기">
            {sidebarOpen ? '목록 숨기기 ▸' : '◂ 마커 목록'}
          </button>
        )}
        <button className={`btn small ${shareState.shared ? 'sharing' : ''}`} onClick={() => setShareOpen((v) => !v)} aria-expanded={shareOpen}>
          {shareState.shared ? `공유 중 · ${shareState.peers.length}명` : '공유'}
        </button>
      </div>
      {shareOpen && <SharePanel mapId={map.id} onClose={() => setShareOpen(false)} />}
      {settingsOpen && (
        <CursorGuidePanel guide={guide} crosshair={crosshair} onGuide={updateGuide} onCrosshair={updateCrosshair} onClose={() => setSettingsOpen(false)} />
      )}
      {styleOpen && <MarkerStylePanel style={liveStyle} onChange={changeStyle} onReset={resetStyle} onClose={() => setStyleOpen(false)} />}
      {tool !== 'view' && (
        <DrawToolbar
          tool={tool}
          pen={pen}
          canUndo={canUndo}
          floorStrokeCount={split ? 0 : curStrokeCount}
          showDrawings={showDrawings}
          onTool={changeTool}
          onPen={changePen}
          onUndo={undo}
          onClearFloor={() => setConfirmClear(true)}
          onShowDrawings={changeShowDrawings}
          onDone={() => changeTool('view')}
        />
      )}

      {moving && (
        <div className="notice ok">
          "{moving.label || '마커'}"을(를) 옮길 위치를 지도에서 클릭하시오.
          <button className="btn small ghost" onClick={() => setMoving(null)}>
            취소 (Esc)
          </button>
        </div>
      )}

      <div className="viewer-body">
        <div className="stage-wrap">
          <div className={`panels ${split ? 'split' : ''}`}>
            {split ? (
              <>
                <div className="panel-col">
                  {floorSelect(curA, setFloorA, '왼쪽')}
                  <Panel {...panelProps} floor={floorById(curA)} />
                </div>
                <div className="panel-col">
                  {floorSelect(curB, setFloorB, '오른쪽')}
                  <Panel {...panelProps} floor={floorById(curB)} />
                </div>
              </>
            ) : (
              <div className="panel-col">
                <Panel {...panelProps} floor={floorById(curFloor)} ghost={ghostFloor} />
              </div>
            )}
          </div>

          {probe && !moving && tool === 'view' && (
            <div className="probe-bar" role="toolbar" aria-label="선택 위치">
              <span className="dim">선택 위치</span>
              {!split &&
                map.floors
                  .filter((f) => f.id !== curFloor)
                  .map((f) => (
                    <button key={f.id} className="btn small" onClick={() => setActiveFloor(f.id)}>
                      {f.name}에서 보기
                    </button>
                  ))}
              <button className="btn small primary" onClick={() => setForm({ mode: 'add', w: probe.w, floorId: split ? probe.floorId : curFloor })}>
                + 여기에 마커 추가
              </button>
              <span className="spacer" />
              <button className={`icon-btn ${settingsOpen ? 'on' : ''}`} onClick={() => setSettingsOpen((v) => !v)} title="십자선 설정" aria-label="십자선 설정" aria-expanded={settingsOpen}>
                ⚙
              </button>
              <button
                className="btn small ghost"
                onClick={() => {
                  setProbe(null);
                  setForm(null);
                  setSelectedMarker(null);
                }}
              >
                닫기
              </button>
            </div>
          )}


          {form && (
            <div className="popover form-pop">
              <MarkerForm
                key={form.mode === 'edit' ? form.marker.id : `${form.w.x},${form.w.y}`}
                map={shownMap}
                w={form.mode === 'add' ? form.w : (markerWorld(map, form.marker) ?? { x: 0, y: 0 })}
                originFloorId={form.mode === 'add' ? form.floorId : curFloor}
                editing={form.mode === 'edit' ? form.marker : undefined}
                onSubmit={submitForm}
                onCancel={() => setForm(null)}
              />
            </div>
          )}
        </div>

        {!split && sidebarOpen && (
          <Sidebar
            map={shownMap}
            floorId={curFloor}
            selectedId={selectedMarker}
            onHover={onHoverMarker}
            onSelect={(m) => onMarkerClick(m, curFloor)}
            onEdit={(m) => setForm({ mode: 'edit', marker: m })}
            onMove={(m) => {
              setForm(null);
              setMoving(m);
            }}
            onDelete={setPendingDelete}
          />
        )}
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="낙서 지우기"
          message={`"${map.floors.find((f) => f.id === curFloor)?.name ?? ''}"의 낙서 ${curStrokeCount}개를 모두 지우겠소? 공유 중이면 상대 화면에서도 사라지오.`}
          confirmLabel="모두 지우기"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            repo.saveMap(clearFloorStrokes(latestMap(), curFloor));
            setConfirmClear(false);
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="마커 삭제"
          message={`"${pendingDelete.label || '이름 없는 마커'}"을(를) 삭제하겠소?${pendingDelete.scope.kind === 'through' ? ' 관통 마커이므로 모든 층에서 사라지오.' : ''}`}
          confirmLabel="삭제"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            repo.saveMap(deleteMarker(latestMap(), pendingDelete.id));
            if (selectedMarker === pendingDelete.id) setSelectedMarker(null);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
