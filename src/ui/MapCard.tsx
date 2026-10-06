import { useEffect, useRef, useState } from 'react';
import type { GameMap } from '../model';
import { useImageUrl } from './hooks';

interface Props {
  map: GameMap;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
}

export function MapCard({ map, onOpen, onExport, onDelete }: Props) {
  const thumb = useImageUrl(map.floors[0]?.imageId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const pick = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div className="mapcard">
      <button className="mapcard-main" onClick={onOpen}>
        <div className="thumb">{thumb && <img src={thumb} alt="" />}</div>
        <div className="name">{map.name}</div>
        <div className="meta">
          {map.floors.length}개 층 · 마커 {map.markers.length}개
        </div>
      </button>
      <div className="card-menu" ref={menuRef}>
        <button className="icon-btn" aria-label="맵 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
          ⋯
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button role="menuitem" disabled title="M7에서 만들어지오">
              편집 (준비 중)
            </button>
            <button role="menuitem" onClick={pick(onExport)}>
              내보내기 (.mapops)
            </button>
            <button role="menuitem" className="danger-text" onClick={pick(onDelete)}>
              삭제
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
