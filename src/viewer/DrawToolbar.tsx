import { useState } from 'react';
import { newId } from '../model';
import { arrowHeadPath, dashArray, PEN_COLORS, PEN_WIDTH_MAX, PEN_WIDTH_MIN, PEN_WIDTHS, type DashStyle, type PenPreset, type PenSettings } from './drawOps';
import type { Tool } from './Panel';

interface Props {
  tool: Tool;
  pen: PenSettings;
  presets: PenPreset[];
  canUndo: boolean;
  floorStrokeCount: number;
  showDrawings: boolean;
  onTool: (t: Tool) => void;
  onPen: (patch: Partial<PenSettings>) => void;
  onPresets: (list: PenPreset[]) => void;
  onUndo: () => void;
  onClearFloor: () => void;
  onShowDrawings: (v: boolean) => void;
  onDone: () => void;
}

const DASHES: { value: DashStyle; label: string }[] = [
  { value: 'solid', label: '실선' },
  { value: 'dash', label: '파선' },
  { value: 'dot', label: '점선' },
];

const samePen = (a: PenSettings, b: PenSettings) =>
  a.color.toLowerCase() === b.color.toLowerCase() && a.width === b.width && a.opacity === b.opacity && a.dash === b.dash && a.arrow === b.arrow;

/** 펜 모양 미리보기(짧은 선 + 화살표). */
function PenPreview({ pen, w = 44, h = 16 }: { pen: PenSettings; w?: number; h?: number }) {
  const sw = Math.min(pen.width, h - 4);
  const pts = [4, h / 2, w - 6, h / 2];
  return (
    <svg width={w} height={h} className="pen-preview" aria-hidden>
      <g opacity={pen.opacity}>
        <path d={`M${pts[0]} ${pts[1]}L${pts[2]} ${pts[3]}`} stroke={pen.color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={dashArray(pen.dash, sw)} fill="none" />
        {pen.arrow && <path d={arrowHeadPath(pts, Math.max(sw, 1.5))} fill={pen.color} />}
      </g>
    </svg>
  );
}

export function DrawToolbar(p: Props) {
  const [editing, setEditing] = useState(false);
  const active = p.presets.find((x) => samePen(x, p.pen));

  const saveCurrent = () => {
    const name = `${p.pen.arrow ? '화살표' : p.pen.opacity < 0.6 ? '형광펜' : '펜'} ${p.presets.length + 1}`;
    p.onPresets([...p.presets, { ...p.pen, id: newId(), name }].slice(0, 12));
  };

  return (
    <div className="draw-toolbar" role="toolbar" aria-label="그리기 도구">
      <div className="draw-row">
        <div className="seg-inline">
          <button className={p.tool === 'pen' ? 'on' : ''} aria-pressed={p.tool === 'pen'} onClick={() => p.onTool('pen')}>
            ✏ 펜
          </button>
          <button className={p.tool === 'eraser' ? 'on' : ''} aria-pressed={p.tool === 'eraser'} onClick={() => p.onTool('eraser')} title="E를 누른 채 써도 지우개">
            ⌫ 지우개 <kbd>E</kbd>
          </button>
        </div>

        <div className="preset-list" role="radiogroup" aria-label="저장한 펜">
          {p.presets.map((pr) => (
            <span key={pr.id} className={`preset ${active?.id === pr.id ? 'on' : ''}`}>
              <button
                role="radio"
                aria-checked={active?.id === pr.id}
                title={pr.name}
                onClick={() => {
                  p.onPen({ color: pr.color, width: pr.width, opacity: pr.opacity, dash: pr.dash, arrow: pr.arrow });
                  p.onTool('pen');
                }}
              >
                <PenPreview pen={pr} w={36} />
                <span className="preset-name">{pr.name}</span>
              </button>
              {editing && (
                <button className="preset-del" aria-label={`${pr.name} 지우기`} onClick={() => p.onPresets(p.presets.filter((x) => x.id !== pr.id))}>
                  ✕
                </button>
              )}
            </span>
          ))}
          <button className="btn small ghost" onClick={saveCurrent} disabled={!!active || p.presets.length >= 12} title="지금 펜 설정을 저장">
            + 지금 펜 저장
          </button>
          <button className={`btn small ghost ${editing ? 'on' : ''}`} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? '편집 끝' : '편집'}
          </button>
        </div>

        <span className="spacer" />
        <button className="btn small" onClick={p.onUndo} disabled={!p.canUndo} title="Ctrl+Z">
          ↶ 되돌리기
        </button>
        <button className="btn small ghost danger-text" onClick={p.onClearFloor} disabled={p.floorStrokeCount === 0}>
          이 층 낙서 지우기
        </button>
        <button className="btn small primary" onClick={p.onDone} title="D 또는 Esc">
          그리기 끝 <kbd>D</kbd>
        </button>
      </div>

      <div className="draw-row pen-editor">
        <PenPreview pen={p.pen} w={56} h={22} />
        <div className="swatches" aria-label="펜 색">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch-btn ${p.pen.color.toLowerCase() === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={`색 ${c}`}
              aria-pressed={p.pen.color.toLowerCase() === c}
              onClick={() => p.onPen({ color: c })}
            />
          ))}
          <label className="custom-color" title="다른 색 고르기">
            <input type="color" value={p.pen.color} onChange={(e) => p.onPen({ color: e.target.value })} aria-label="다른 색 고르기" />
          </label>
        </div>
        <label className="range-field">
          굵기 {p.pen.width}px
          <input type="range" min={PEN_WIDTH_MIN} max={PEN_WIDTH_MAX} step={1} value={p.pen.width} onChange={(e) => p.onPen({ width: Number(e.target.value) })} />
        </label>
        <div className="widths" aria-label="빠른 굵기">
          {PEN_WIDTHS.map((w) => (
            <button key={w} className={p.pen.width === w ? 'on' : ''} aria-pressed={p.pen.width === w} onClick={() => p.onPen({ width: w })} title={`${w}px`}>
              <span className="width-dot" style={{ width: w + 2, height: w + 2, background: p.pen.color }} />
            </button>
          ))}
        </div>
        <label className="range-field">
          불투명도 {Math.round(p.pen.opacity * 100)}%
          <input type="range" min={0.1} max={1} step={0.05} value={p.pen.opacity} onChange={(e) => p.onPen({ opacity: Number(e.target.value) })} />
        </label>
        <div className="seg-inline" role="radiogroup" aria-label="선 모양">
          {DASHES.map((d) => (
            <button key={d.value} role="radio" aria-checked={p.pen.dash === d.value} className={p.pen.dash === d.value ? 'on' : ''} onClick={() => p.onPen({ dash: d.value })}>
              {d.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={p.pen.arrow} onChange={(e) => p.onPen({ arrow: e.target.checked })} />
          끝 화살표
        </label>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={p.showDrawings} onChange={(e) => p.onShowDrawings(e.target.checked)} />
          보기 모드에서도 낙서 표시
        </label>
      </div>
      <span className="hint draw-hint">오른쪽 버튼 끌기: 화면 이동 · 휠: 확대 · 저장한 펜은 이 기기에만 남소</span>
    </div>
  );
}
