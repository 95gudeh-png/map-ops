import { PEN_COLORS, PEN_WIDTHS } from './drawOps';
import type { PenSettings, Tool } from './Panel';

interface Props {
  tool: Tool;
  pen: PenSettings;
  canUndo: boolean;
  floorStrokeCount: number;
  showDrawings: boolean;
  onTool: (t: Tool) => void;
  onPen: (p: PenSettings) => void;
  onUndo: () => void;
  onClearFloor: () => void;
  onShowDrawings: (v: boolean) => void;
  onDone: () => void;
}

export function DrawToolbar(p: Props) {
  return (
    <div className="draw-toolbar" role="toolbar" aria-label="그리기 도구">
      <div className="seg-inline">
        <button className={p.tool === 'pen' ? 'on' : ''} aria-pressed={p.tool === 'pen'} onClick={() => p.onTool('pen')}>
          ✏ 펜
        </button>
        <button className={p.tool === 'eraser' ? 'on' : ''} aria-pressed={p.tool === 'eraser'} onClick={() => p.onTool('eraser')}>
          ⌫ 지우개
        </button>
      </div>

      <div className="swatches" aria-label="펜 색">
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch-btn ${p.pen.color === c ? 'on' : ''}`}
            style={{ background: c }}
            aria-label={`색 ${c}`}
            aria-pressed={p.pen.color === c}
            onClick={() => p.onPen({ ...p.pen, color: c })}
          />
        ))}
        <label className="custom-color" title="다른 색">
          <input type="color" value={p.pen.color} onChange={(e) => p.onPen({ ...p.pen, color: e.target.value })} aria-label="다른 색 고르기" />
        </label>
      </div>

      <div className="widths" aria-label="펜 굵기">
        {PEN_WIDTHS.map((w) => (
          <button key={w} className={p.pen.width === w ? 'on' : ''} aria-pressed={p.pen.width === w} onClick={() => p.onPen({ ...p.pen, width: w })} title={`${w}px`}>
            <span className="width-dot" style={{ width: w + 2, height: w + 2, background: p.pen.color }} />
          </button>
        ))}
      </div>

      <button className="btn small" onClick={p.onUndo} disabled={!p.canUndo} title="Ctrl+Z">
        ↶ 되돌리기
      </button>
      <button className="btn small ghost danger-text" onClick={p.onClearFloor} disabled={p.floorStrokeCount === 0}>
        이 층 낙서 지우기
      </button>
      <span className="spacer" />
      <label className="check">
        <input type="checkbox" checked={p.showDrawings} onChange={(e) => p.onShowDrawings(e.target.checked)} />
        보기 모드에서도 낙서 표시
      </label>
      <button className="btn small primary" onClick={p.onDone}>
        그리기 끝
      </button>
      <span className="hint draw-hint">오른쪽 버튼 끌기: 화면 이동 · 휠: 확대</span>
    </div>
  );
}
