import { DEFAULT_CROSSHAIR, DEFAULT_CURSOR_GUIDE, RETICLE_SHAPES, type CrosshairSettings, type CursorGuideSettings, type ReticleShape } from './crosshair';
import { Reticle } from './Reticle';

interface Props {
  guide: CursorGuideSettings;
  crosshair: CrosshairSettings;
  onGuide: (patch: Partial<CursorGuideSettings>) => void;
  onCrosshair: (patch: Partial<CrosshairSettings>) => void;
  onClose: () => void;
}

const SHAPE_LABEL: Record<ReticleShape, string> = { cross: '십자', dot: '점', circle: '원', crossDot: '십자+점', none: '없음' };

/** 커서 가이드 + 클릭 위치 십자선 설정(기기별). 조작 즉시 반영된다. */
export function CursorGuidePanel({ guide: g, crosshair: c, onGuide, onCrosshair, onClose }: Props) {
  return (
    <div className="popover guide-pop" role="dialog" aria-label="커서 가이드" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="form-title">커서 가이드 (이 기기에만 적용)</div>
      <label className="check-row">
        <input type="checkbox" checked={g.enabled} onChange={(e) => onGuide({ enabled: e.target.checked })} />
        마우스를 따라다니는 가이드 사용
      </label>
      <p className="hint">2단 비교에서는 한쪽에서 움직이면 다른 쪽에도 같은 지도 위치에 표시되오.</p>

      <fieldset disabled={!g.enabled}>
        <legend>가이드 선 (화면 끝까지)</legend>
        <label className="check-row">
          <input type="checkbox" checked={g.lines} onChange={(e) => onGuide({ lines: e.target.checked })} />
          가로·세로 선 표시
        </label>
        <div className="inline-fields">
          <label className="color-field">
            색
            <input type="color" value={g.lineColor} onChange={(e) => onGuide({ lineColor: e.target.value })} />
          </label>
          <label>
            불투명도 {Math.round(g.lineOpacity * 100)}%
            <input type="range" min={0.1} max={1} step={0.05} value={g.lineOpacity} onChange={(e) => onGuide({ lineOpacity: Number(e.target.value) })} />
          </label>
          <label>
            굵기 {g.lineWidth}px
            <input type="range" min={1} max={4} step={1} value={g.lineWidth} onChange={(e) => onGuide({ lineWidth: Number(e.target.value) })} />
          </label>
        </div>
      </fieldset>

      <fieldset disabled={!g.enabled}>
        <legend>가운데 표시</legend>
        <div className="shape-picker" role="radiogroup" aria-label="모양">
          {RETICLE_SHAPES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={g.reticle === s} className={g.reticle === s ? 'on' : ''} onClick={() => onGuide({ reticle: s })}>
              <span className="shape-preview">
                {s === 'none' ? '—' : <Reticle shape={s} size={16} color={g.reticle === s ? g.reticleColor : '#8b96a5'} thickness={2} gap={3} />}
              </span>
              {SHAPE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="inline-fields">
          <label className="color-field">
            색
            <input type="color" value={g.reticleColor} onChange={(e) => onGuide({ reticleColor: e.target.value })} />
          </label>
          <label>
            크기 {g.reticleSize}px
            <input type="range" min={6} max={48} step={1} value={g.reticleSize} onChange={(e) => onGuide({ reticleSize: Number(e.target.value) })} />
          </label>
          <label>
            굵기 {g.reticleThickness}px
            <input type="range" min={1} max={5} step={1} value={g.reticleThickness} onChange={(e) => onGuide({ reticleThickness: Number(e.target.value) })} />
          </label>
          <label>
            가운데 빈틈 {g.gap}px
            <input type="range" min={0} max={16} step={1} value={g.gap} onChange={(e) => onGuide({ gap: Number(e.target.value) })} />
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={g.hideCursor} onChange={(e) => onGuide({ hideCursor: e.target.checked })} />
          기본 마우스 화살표 숨기기
        </label>
      </fieldset>

      <fieldset>
        <legend>클릭한 위치 표시(고정 십자선)</legend>
        <div className="inline-fields">
          <label className="color-field">
            색
            <input type="color" value={c.color} onChange={(e) => onCrosshair({ color: e.target.value })} />
          </label>
          <label>
            길이 {c.length}px
            <input type="range" min={10} max={50} value={c.length} onChange={(e) => onCrosshair({ length: Number(e.target.value) })} />
          </label>
          <label>
            굵기 {c.thickness}px
            <input type="range" min={1} max={6} value={c.thickness} onChange={(e) => onCrosshair({ thickness: Number(e.target.value) })} />
          </label>
        </div>
      </fieldset>

      <div className="form-actions">
        <button
          className="btn small ghost"
          onClick={() => {
            onGuide(DEFAULT_CURSOR_GUIDE);
            onCrosshair(DEFAULT_CROSSHAIR);
          }}
        >
          기본값으로
        </button>
        <button className="btn small" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}
