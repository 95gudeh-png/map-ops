import { markerOnFloor, markerWorld } from '../mapOps';
import { MARKER_TYPES, markerColor, type GameMap, type Id, type Marker } from '../model';
import type { Vec } from '../geometry';
import { throughFloorsLabel } from './markerOps';

interface Props {
  map: GameMap;
  floorId: Id;
  selectedId: Id | null;
  onHover: (w: Vec | null, markerId?: Id) => void;
  onSelect: (m: Marker) => void;
  onEdit: (m: Marker) => void;
  onMove: (m: Marker) => void;
  onDelete: (m: Marker) => void;
}

export function Sidebar({ map, floorId, selectedId, onHover, onSelect, onEdit, onMove, onDelete }: Props) {
  const onFloor = map.markers.filter((m) => markerOnFloor(m, floorId));
  const single = onFloor.filter((m) => m.scope.kind === 'floor');
  const through = onFloor.filter((m) => m.scope.kind === 'through');

  const row = (m: Marker) => (
    <li
      key={m.id}
      className={`mk-row ${selectedId === m.id ? 'selected' : ''}`}
      onPointerEnter={() => onHover(markerWorld(map, m), m.id)}
      title="마우스를 올리고 Delete 키로 삭제"
      onPointerLeave={() => onHover(null)}
    >
      <button className="mk-main" onClick={() => onSelect(m)} title="이 위치 선택">
        <span className={`mk-dot ${m.scope.kind}`} style={{ ['--mk' as string]: markerColor(map.markerStyle, m.type) }} />
        <span className="lbl">
          {m.label || MARKER_TYPES[m.type].label}
          {m.scope.kind === 'through' && <span className="sub">{throughFloorsLabel(map, m)}</span>}
        </span>
      </button>
      <span className="mk-actions">
        <button onClick={() => onEdit(m)} title="수정" aria-label={`${m.label || '마커'} 수정`}>
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

  return (
    <aside className="sidebar">
      <h4>이 층 마커 ({single.length})</h4>
      {single.length === 0 ? <p className="dim small">없소. 지도를 클릭하고 "+ 여기에 마커 추가"를 누르시오.</p> : <ul>{single.map(row)}</ul>}
      <h4>관통 마커 ({through.length})</h4>
      {through.length === 0 ? <p className="dim small">없소.</p> : <ul>{through.map(row)}</ul>}
    </aside>
  );
}
