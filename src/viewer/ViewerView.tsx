/** 사용 화면(명세서 §3.6, §4.2). */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fitView, floorWorldRect, panView, zoomViewAt, type Size, type Vec, type View } from '../geometry';
import { markerWorld } from '../mapOps';
import type { GameMap, Id, Marker } from '../model';
import { SharePanel } from '../share/SharePanel';
import { shareManager, useRemoteProbes, useShareState } from '../share/shareManager';
import { repo } from '../store/repo';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { loadCrosshair, saveCrosshair, type CrosshairSettings } from './crosshair';
import { MarkerForm } from './MarkerForm';
import { addMarker, deleteMarker, moveMarker, updateMarker, type MarkerInput } from './markerOps';
import { Panel, type Painter, type PanelShared } from './Panel';
import { Sidebar } from './Sidebar';

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
  const [selectedMarker, setSelectedMarker] = useState<Id | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const shareState = useShareState(map.id);
  const remoteProbes = useRemoteProbes(map.id);

  // 층이 삭제·변경돼도 유효한 층을 가리키도록
  const valid = (id: Id) => (map.floors.some((f) => f.id === id) ? id : firstId);
  const curFloor = valid(activeFloor);
  const curA = valid(floorA);
  const curB = valid(floorB);

  /* ---------- 공유 뷰·십자선 ---------- */
  const view = useRef<View | null>(null);
  const cross = useRef<Vec | null>(null);
  const hover = useRef<Vec | null>(null);
  const fitZ = useRef(1);
  const panelSize = useRef<Size>({ w: 0, h: 0 });
  const painters = useRef(new Set<Painter>());
  const shared = useMemo<PanelShared>(() => ({ view, cross }), []);
  const probeRef = useRef(probe);
  probeRef.current = probe;

  const paintAll = useCallback(() => {
    cross.current = hover.current ?? probeRef.current?.w ?? null;
    for (const p of painters.current) p();
  }, []);
  const registerPainter = useCallback((p: Painter) => {
    painters.current.add(p);
    return () => void painters.current.delete(p);
  }, []);

  const mapRef = useRef(map);
  mapRef.current = map;
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
      repo.saveMap(moveMarker(mapRef.current, mv.id, w));
      setMoving(null);
      setSelectedMarker(mv.id);
      setProbe({ w, floorId });
      return;
    }
    setForm(null);
    setSelectedMarker(null);
    setProbe({ w, floorId });
  }, []);
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
      if (e.key !== 'Escape' || (e.target as HTMLElement).closest('input, textarea, form')) return;
      if (moving) setMoving(null);
      else if (form) setForm(null);
      else if (settingsOpen) setSettingsOpen(false);
      else {
        setProbe(null);
        setSelectedMarker(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moving, form, settingsOpen]);

  /* ---------- 마커 저장 ---------- */
  const submitForm = (input: MarkerInput) => {
    if (!form) return;
    if (form.mode === 'add') {
      const r = addMarker(map, input);
      repo.saveMap(r.map);
      setSelectedMarker(r.marker.id);
    } else {
      repo.saveMap(updateMarker(map, form.marker.id, input));
    }
    setForm(null);
  };

  const updateCrosshair = (patch: Partial<CrosshairSettings>) => {
    const next = { ...crosshair, ...patch };
    setCrosshair(next);
    saveCrosshair(next);
  };

  /* ---------- 표시 ---------- */
  const floorById = (id: Id) => map.floors.find((f) => f.id === id)!;
  const idx = map.floors.findIndex((f) => f.id === curFloor);
  const ghostFloor = ghost && !split && idx > 0 ? map.floors[idx - 1] : undefined;
  const crossStyle = { '--ch-len': `${crosshair.length}px`, '--ch-thick': `${crosshair.thickness}px`, '--ch-color': crosshair.color } as CSSProperties;

  const panelProps = {
    map,
    shared,
    showLabels,
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
    <div className={`viewer ${moving ? 'moving' : ''}`} style={crossStyle}>
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
        <button className="btn small ghost" onClick={onEditMap}>
          맵 편집
        </button>
        <button className={`btn small ${shareState.shared ? 'sharing' : ''}`} onClick={() => setShareOpen((v) => !v)} aria-expanded={shareOpen}>
          {shareState.shared ? `공유 중 · ${shareState.peers.length}명` : '공유'}
        </button>
      </div>
      {shareOpen && <SharePanel mapId={map.id} onClose={() => setShareOpen(false)} />}

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

          {probe && !moving && (
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

          {settingsOpen && probe && (
            <div className="popover settings">
              <div className="form-title">십자선 설정</div>
              <label>
                길이 {crosshair.length}px
                <input type="range" min={10} max={50} value={crosshair.length} onChange={(e) => updateCrosshair({ length: Number(e.target.value) })} />
              </label>
              <label>
                굵기 {crosshair.thickness}px
                <input type="range" min={1} max={6} value={crosshair.thickness} onChange={(e) => updateCrosshair({ thickness: Number(e.target.value) })} />
              </label>
              <label className="color">
                색상
                <input type="color" value={crosshair.color} onChange={(e) => updateCrosshair({ color: e.target.value })} />
              </label>
            </div>
          )}

          {form && (
            <div className="popover form-pop">
              <MarkerForm
                key={form.mode === 'edit' ? form.marker.id : `${form.w.x},${form.w.y}`}
                map={map}
                w={form.mode === 'add' ? form.w : (markerWorld(map, form.marker) ?? { x: 0, y: 0 })}
                originFloorId={form.mode === 'add' ? form.floorId : curFloor}
                editing={form.mode === 'edit' ? form.marker : undefined}
                onSubmit={submitForm}
                onCancel={() => setForm(null)}
              />
            </div>
          )}
        </div>

        {!split && (
          <Sidebar
            map={map}
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

      {pendingDelete && (
        <ConfirmDialog
          title="마커 삭제"
          message={`"${pendingDelete.label || '이름 없는 마커'}"을(를) 삭제하겠소?${pendingDelete.scope.kind === 'through' ? ' 관통 마커이므로 모든 층에서 사라지오.' : ''}`}
          confirmLabel="삭제"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            repo.saveMap(deleteMarker(map, pendingDelete.id));
            if (selectedMarker === pendingDelete.id) setSelectedMarker(null);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
