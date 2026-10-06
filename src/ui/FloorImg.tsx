import { memo, type CSSProperties } from 'react';
import type { Sim } from '../geometry';
import type { Floor } from '../model';
import { useImageUrl } from './hooks';

/** 화면 변환(층 픽셀 → 화면)을 CSS transform 문자열로. */
export const simToCss = (s: Sim) => `matrix(${s.r},0,0,${s.r},${s.d.x},${s.d.y})`;

interface Props {
  floor: Floor;
  /** 연속 입력 중 DOM을 직접 갱신하기 위한 등록 콜백(명세서 §8). */
  register?: (el: HTMLImageElement | null) => void;
  /** register 없이 쓸 때의 고정 변환. */
  transform?: Sim;
  style?: CSSProperties;
  className?: string;
}

/**
 * 층 이미지를 원본 픽셀 크기로 놓고 transform으로 배치한다(object-fit 없음, 명세서 §3.3).
 * transform은 React가 관리하지 않으므로 등록된 요소에 직접 써도 재렌더에 덮이지 않는다.
 */
export const FloorImg = memo(function FloorImg({ floor, register, transform, style, className }: Props) {
  const url = useImageUrl(floor.imageId);
  return (
    <img
      ref={(el) => {
        if (el && transform) el.style.transform = simToCss(transform);
        register?.(el);
      }}
      className={`floor-img ${className ?? ''}`}
      src={url ?? undefined}
      width={floor.imageW}
      height={floor.imageH}
      alt={floor.name}
      draggable={false}
      style={{ visibility: url ? 'visible' : 'hidden', ...style }}
    />
  );
});
