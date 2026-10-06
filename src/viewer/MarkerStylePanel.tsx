import { MARKER_TYPES, markerColor, type MarkerOutline, type MarkerStyle, type MarkerType } from '../model';

interface Props {
  style: MarkerStyle;
  /** 바뀐 항목만 넘긴다(상위가 최신 값에 합침 — 빠른 연속 조작에서도 앞의 변경을 잃지 않도록). */
  onChange: (patch: Partial<MarkerStyle>) => void;
  onReset: () => void;
  onClose: () => void;
}

const OUTLINES: { value: MarkerOutline; label: string }[] = [
  { value: 'dark', label: '어두운 테두리' },
  { value: 'light', label: '밝은 테두리' },
  { value: 'none', label: '없음' },
];

/** 맵별 마커 표시 설정. 조작 즉시 화면에 반영되고, 저장은 상위에서 모아서 한다. */
export function MarkerStylePanel({ style, onChange, onReset, onClose }: Props) {
  const set = onChange;
  return (
    <div className="popover style-pop" role="dialog" aria-label="마커 모양" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="form-title">마커 모양 (이 맵에만 적용)</div>

      <label>
        크기 {Math.round(style.size * 100)}%
        <input type="range" min={0.5} max={2.5} step={0.05} value={style.size} onChange={(e) => set({ size: Number(e.target.value) })} />
      </label>
      <label>
        불투명도 {Math.round(style.opacity * 100)}%
        <input type="range" min={0.2} max={1} step={0.05} value={style.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
      </label>
      <label>
        이름표 글자 {style.labelSize}px
        <input type="range" min={9} max={20} step={1} value={style.labelSize} onChange={(e) => set({ labelSize: Number(e.target.value) })} />
      </label>

      <div className="field">
        테두리
        <div className="seg-inline">
          {OUTLINES.map((o) => (
            <button key={o.value} className={style.outline === o.value ? 'on' : ''} aria-pressed={style.outline === o.value} onClick={() => set({ outline: o.value })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        유형별 색
        <div className="type-colors">
          {(Object.keys(MARKER_TYPES) as MarkerType[]).map((t) => (
            <label key={t} className="type-color">
              <input
                type="color"
                value={markerColor(style, t)}
                onChange={(e) => set({ colors: { [t]: e.target.value } })}
                aria-label={`${MARKER_TYPES[t].label} 색`}
              />
              {MARKER_TYPES[t].label}
            </label>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button className="btn small ghost" onClick={onReset}>
          기본값으로
        </button>
        <button className="btn small" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
