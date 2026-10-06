import type { ReticleShape } from './crosshair';

interface Props {
  shape: ReticleShape;
  size: number;
  color: string;
  thickness: number;
  gap: number;
}

/** 중앙 표시(레티클). (0,0)이 중심인 SVG를 그린다 — 배치는 부모가 transform으로. */
export function Reticle({ shape, size, color, thickness, gap }: Props) {
  if (shape === 'none') return null;
  const h = size / 2;
  const g = Math.min(gap, h - 1);
  const cross = shape === 'cross' || shape === 'crossDot';
  const dot = shape === 'dot' || shape === 'crossDot';
  const pad = thickness + 2;
  const box = size + pad * 2;
  return (
    <svg className="reticle" width={box} height={box} viewBox={`${-h - pad} ${-h - pad} ${box} ${box}`} aria-hidden>
      <g stroke={color} strokeWidth={thickness} strokeLinecap="round" fill="none">
        {cross && (
          <>
            <line x1={-h} y1={0} x2={-g} y2={0} />
            <line x1={g} y1={0} x2={h} y2={0} />
            <line x1={0} y1={-h} x2={0} y2={-g} />
            <line x1={0} y1={g} x2={0} y2={h} />
          </>
        )}
        {shape === 'circle' && <circle r={h - thickness / 2} />}
      </g>
      {dot && <circle r={Math.max(1.5, shape === 'dot' ? size / 5 : thickness)} fill={color} />}
    </svg>
  );
}
