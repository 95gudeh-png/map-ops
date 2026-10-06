import { useEffect, useRef, useState } from 'react';
import type { Vec } from '../geometry';
import { MARKER_TYPES, markerColor, type GameMap, type Id, type Marker, type MarkerType } from '../model';
import type { MarkerInput } from './markerOps';

interface Props {
  map: GameMap;
  w: Vec;
  originFloorId: Id;
  /** 수정 모드면 기존 마커. */
  editing?: Marker;
  onSubmit: (input: MarkerInput) => void;
  onCancel: () => void;
}

const TYPES = Object.keys(MARKER_TYPES) as MarkerType[];

export function MarkerForm({ map, w, originFloorId, editing, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<MarkerType>(editing?.type ?? 'objective');
  const [label, setLabel] = useState(editing?.label ?? '');
  const [through, setThrough] = useState(editing ? editing.scope.kind === 'through' : false);
  const [floorIds, setFloorIds] = useState<Id[]>(
    editing?.scope.kind === 'through' ? editing.scope.floorIds : map.floors.map((f) => f.id),
  );
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => labelRef.current?.focus(), []);

  const forcedThrough = type === 'connector';
  const isThrough = forcedThrough || through;
  const origin = editing?.scope.kind === 'floor' ? editing.scope.floorId : originFloorId;
  const originName = map.floors.find((f) => f.id === origin)?.name ?? '';

  const submit = () => onSubmit({ type, label, w, originFloorId: origin, through: isThrough, floorIds });

  return (
    <form
      className="marker-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <div className="form-title">{editing ? '마커 수정' : '마커 추가'}</div>
      <div className="seg" role="radiogroup" aria-label="유형">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className={type === t ? 'on' : ''}
            style={{ ['--mk' as string]: markerColor(map.markerStyle, t) }}
            onClick={() => setType(t)}
          >
            <span className="swatch" />
            {MARKER_TYPES[t].label}
          </button>
        ))}
      </div>
      <input ref={labelRef} className="text-input" type="text" placeholder="마커 이름 (선택)" value={label} onChange={(e) => setLabel(e.target.value)} />

      <fieldset className="scope">
        <legend>범위</legend>
        <label>
          <input type="radio" name="scope" checked={!isThrough} disabled={forcedThrough} onChange={() => setThrough(false)} />
          이 층만 ({originName})
        </label>
        <label>
          <input type="radio" name="scope" checked={isThrough} onChange={() => setThrough(true)} />
          여러 층 관통
        </label>
        {forcedThrough && <p className="hint">층간연결은 항상 관통 마커이오.</p>}
        {isThrough && (
          <div className="floor-checks">
            {map.floors.map((f) => (
              <label key={f.id}>
                <input
                  type="checkbox"
                  checked={f.id === origin || floorIds.includes(f.id)}
                  disabled={f.id === origin}
                  onChange={(e) => setFloorIds((ids) => (e.target.checked ? [...ids, f.id] : ids.filter((x) => x !== f.id)))}
                />
                {f.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="form-actions">
        <button type="button" className="btn small ghost" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className="btn small primary">
          {editing ? '저장' : '추가'}
        </button>
      </div>
    </form>
  );
}
