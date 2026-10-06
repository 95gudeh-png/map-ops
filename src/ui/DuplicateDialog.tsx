import { useEffect, useState } from 'react';
import { mergeMaps } from '../mapMerge';
import type { GameMap, Id } from '../model';
import { shareManager } from '../share/shareManager';
import { repo } from '../store/repo';

interface Props {
  groups: GameMap[][];
  onDone: (message: string) => void;
  onIgnore: (groups: GameMap[][]) => void;
  onCancel: () => void;
}

const weight = (m: GameMap) => m.markers.length + (m.strokes?.length ?? 0);

/** 기본으로 남길 맵: 내용(마커+낙서)이 가장 많은 것, 같으면 먼저 추가된 것. */
export function defaultKeep(group: GameMap[]): Id {
  return group.reduce((best, m) => (weight(m) > weight(best) ? m : best), group[0]!).id;
}

export function DuplicateDialog({ groups, onDone, onIgnore, onCancel }: Props) {
  const [keep, setKeep] = useState<Record<number, Id>>(() => Object.fromEntries(groups.map((g, i) => [i, defaultKeep(g)])));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const merge = async () => {
    setBusy(true);
    let markers = 0, strokes = 0, skipped = 0, removed = 0;
    try {
      for (const [i, group] of groups.entries()) {
        const keepId = keep[i]!;
        let target = repo.getMap(keepId) ?? group.find((m) => m.id === keepId)!;
        for (const m of group) {
          if (m.id === keepId) continue;
          const source = repo.getMap(m.id) ?? m;
          const r = mergeMaps(target, source);
          target = r.map;
          markers += r.markersAdded;
          strokes += r.strokesAdded;
          skipped += r.skipped;
        }
        repo.saveMap(target);
        for (const m of group) {
          if (m.id === keepId) continue;
          shareManager.onMapDeleted(m.id);
          await repo.deleteMap(m.id);
          removed++;
        }
      }
      onDone(
        `중복 맵 ${removed}개를 합쳤소. 옮긴 마커 ${markers}개, 낙서 ${strokes}개${skipped ? `, 짝이 맞는 층이 없어 옮기지 못한 항목 ${skipped}개` : ''}.`,
      );
    } catch (e) {
      onDone(`합치다 오류가 났소: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="dialog dup-dialog" role="dialog" aria-modal="true" aria-labelledby="dup-title">
        <h3 id="dup-title">중복 맵 정리</h3>
        <p>
          같은 단면도로 따로 만든 맵이 겹쳐 있소. 보통 공개 사이트와 localhost(실행 파일)처럼 다른 주소에서 각각 만들었을 때 생기오.
          그룹마다 남길 맵을 고르면, 나머지 맵의 마커와 낙서를 남길 맵에 옮겨 담고 나머지는 지우오.
        </p>
        {groups.map((group, i) => (
          <fieldset key={i} className="dup-group">
            <legend>
              {group[0]!.name} 외 {group.length - 1}개 · 층 {group[0]!.floors.length}개
            </legend>
            {group.map((m) => (
              <label key={m.id} className="dup-row">
                <input type="radio" name={`keep-${i}`} checked={keep[i] === m.id} onChange={() => setKeep({ ...keep, [i]: m.id })} />
                <span className="dup-name">{m.name}</span>
                <span className="dim small">
                  마커 {m.markers.length} · 낙서 {m.strokes?.length ?? 0}
                  {shareManager.isIncluded(m.id) ? ' · 세션' : ''}
                </span>
                {keep[i] === m.id && <span className="badge ok small">남김</span>}
              </label>
            ))}
          </fieldset>
        ))}
        <p className="hint">지운 맵은 공유 세션에서도 빠지오. 친구 화면에도 같은 중복이 있다면 친구도 이 정리를 한 번 하면 되오.</p>
        <div className="dialog-actions">
          <button className="btn ghost" disabled={busy} onClick={() => onIgnore(groups)}>
            이대로 두기
          </button>
          <button className="btn ghost" disabled={busy} onClick={onCancel}>
            나중에
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void merge()} autoFocus>
            {busy ? '합치는 중…' : '합치기'}
          </button>
        </div>
      </div>
    </div>
  );
}
