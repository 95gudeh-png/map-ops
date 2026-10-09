import { useState, type DragEvent } from 'react';
import { markerOnFloor, markerWorld } from '../mapOps';
import { MARKER_TYPES, markerColor, type GameMap, type Id, type Marker } from '../model';
import type { Vec } from '../geometry';
import { throughFloorsLabel } from './markerOps';

type Zone = 'floor' | 'through';
const DRAG_TYPE = 'application/x-mapops-marker';

interface Props {
  map: GameMap;
  floorId: Id;
  selectedId: Id | null;
  onHover: (w: Vec | null, markerId?: Id) => void;
  onSelect: (m: Marker) => void;
  onEdit: (m: Marker) => void;
  onMove: (m: Marker) => void;
  onDelete: (m: Marker) => void;
  /** 목록 사이로 끌어다 놓아 단일층 ↔ 관통 전환. */
  onConvert: (m: Marker, to: Zone) => void;
}

export function Sidebar({ map, floorId, selectedId, onHover, onSelect, onEdit, onMove, onDelete, onConvert }: Props) {
  const onFloor = map.markers.filter((m) => markerOnFloor(m, floorId));
  const single = onFloor.filter((m) => m.scope.kind === 'floor');
  const through = onFloor.filter((m) => m.scope.kind === 'through');
  /** 끄는 중인 마커와 그 마커가 갈 수 있는 칸. */
  const [dragging, setDragging] = useState<{ id: Id; target: Zone; allowed: boolean } | null>(null);
  const [over, setOver] = useState<Zone | null>(null);

  const startDrag = (e: DragEvent, m: Marker) => {
    e.dataTransfer.setData(DRAG_TYPE, m.id);
    e.dataTransfer.effectAllowed = 'move';
    const target: Zone = m.scope.kind === 'floor' ? 'through' : 'floor';
    // 층간연결은 관통만, 층이 하나뿐이면 관통 불가
    const allowed = target === 'floor' ? m.type !== 'connector' : map.floors.length > 1;
    setDragging({ id: m.id, target, allowed });
  };
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };

  const zoneProps = (zone: Zone) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE) || dragging?.target !== zone || !dragging.allowed) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(zone);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === zone ? null : o));
    },
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      const m = map.markers.find((x) => x.id === id);
      endDrag();
      if (!m || m.scope.kind === zone) return;
      e.preventDefault();
      onConvert(m, zone);
    },
    className: `mk-zone ${dragging?.target === zone ? (dragging.allowed ? 'can-drop' : 'no-drop') : ''} ${over === zone ? 'over' : ''}`,
  });

  const row = (m: Marker) => (
    <li
      key={m.id}
      className={`mk-row ${selectedId === m.id ? 'selected' : ''} ${dragging?.id === m.id ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => startDrag(e, m)}
      onDragEnd={endDrag}
      onPointerEnter={() => onHover(markerWorld(map, m), m.id)}
      title="끌어서 다른 칸에 놓으면 이 층만 ↔ 관통 전환 · 마우스를 올리고 Delete로 삭제"
      onPointerLeave={() => onHover(null)}
    >
      <span className="mk-grip" aria-hidden>
        ⠿
      </span>
      <button className="mk-main" onClick={() => onSelect(m)} title="이 위치 선택">
        <span className={`mk-dot ${m.scope.kind}`} style={{ ['--mk' as string]: markerColor(map.markerStyle, m.type) }} />
        <span className="lbl">
          {m.label || MARKER_TYPES[m.type].label}
          {m.scope.kind === 'through' && <span className="sub">{throughFloorsLabel(map, m)}</span>}
        </span>
      </button>
      <span className="mk-actions">
        <button onClick={() => onEdit(m)} title="수정(관통할 층 바꾸기 포함)" aria-label={`${m.label || '마커'} 수정`}>
          ✎
        </button>
        <button onClick={() => onMove(m)} title="위치 옮기기" aria-label={`${m.label || '마커'} 옮기기`}>
          ⤧
        </button>
        <button className="del" onClick={() => onDelete(m)} title="삭제" aria-label={`${m.label || '마커'} 삭제`}>
          ✕
        </button>
      </span>
    </li>
  );

  const dropHint = (zone: Zone) =>
    dragging?.target === zone ? (
      <p className={`drop-hint small ${dragging.allowed ? '' : 'blocked'}`}>
        {!dragging.allowed
          ? zone === 'floor'
            ? '층간연결은 관통 마커로만 쓸 수 있소.'
            : '층이 하나뿐이라 관통할 수 없소.'
          : zone === 'floor'
            ? '여기에 놓으면 이 층에만 보이는 마커가 되오.'
            : '여기에 놓으면 관통 마커가 되오(기본 층으로, ✎에서 층을 고칠 수 있소).'}
      </p>
    ) : null;

  return (
    <aside className="sidebar">
      <section {...zoneProps('floor')}>
        <h4>이 층 마커 ({single.length})</h4>
        {dropHint('floor')}
        {single.length === 0 ? (
          !dragging && <p className="dim small">없소. 지도를 클릭하고 "+ 여기에 마커 추가"를 누르시오.</p>
        ) : (
          <ul>{single.map(row)}</ul>
        )}
      </section>
      <section {...zoneProps('through')}>
        <h4>관통 마커 ({through.length})</h4>
        {dropHint('through')}
        {through.length === 0 ? !dragging && <p className="dim small">없소. 이 층 마커를 여기로 끌어오면 관통 마커가 되오.</p> : <ul>{through.map(row)}</ul>}
      </section>
    </aside>
  );
}
