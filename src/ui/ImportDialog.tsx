import { useEffect, useState } from 'react';
import type { ImportPlan, ImportPolicy } from '../store/exportImport';

interface Props {
  plan: ImportPlan;
  busy: boolean;
  onConfirm: (policy: ImportPolicy) => void;
  onCancel: () => void;
}

const POLICIES: { value: ImportPolicy; label: string; desc: string }[] = [
  { value: 'merge', label: '합치기 (추천)', desc: '이미 있는 맵에 파일 속 마커·낙서를 더하오. 같은 것은 두 번 넣지 않소.' },
  { value: 'skip', label: '건너뛰기', desc: '이미 있는 맵은 그대로 두고, 새 맵만 가져오오.' },
  { value: 'copy', label: '사본으로 추가', desc: '"(가져옴)"을 붙인 별도 맵으로 추가하오. 중복이 생기니 꼭 필요할 때만.' },
];

/** 가져오기 확인: 들어올 맵 목록, 이미 있는 맵과의 관계, 처리 방식 선택. */
export function ImportDialog({ plan, busy, onConfirm, onCancel }: Props) {
  const [policy, setPolicy] = useState<ImportPolicy>('merge');
  const conflicts = plan.items.filter((it) => it.match).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="imp-title">
        <h3 id="imp-title">가져오기 ({plan.items.length}개 맵)</h3>
        <ul className="import-list">
          {plan.items.map((it) => (
            <li key={it.map.id}>
              <span className="imp-name">{it.map.name}</span>
              <span className="dim small">
                층 {it.map.floors.length} · 마커 {it.map.markers.length}
              </span>
              {it.match ? (
                <span className="badge warn" title={it.matchBy === 'id' ? '같은 맵(ID 동일)이 이미 있음' : '같은 단면도로 만든 맵이 이미 있음'}>
                  이미 있음{it.match.name !== it.map.name ? `: ${it.match.name}` : ''}
                </span>
              ) : (
                <span className="badge ok">새 맵</span>
              )}
            </li>
          ))}
        </ul>
        {plan.errors.length > 0 && (
          <div className="notice error small">
            읽지 못한 파일:
            <br />
            {plan.errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        {conflicts > 0 && (
          <fieldset className="policy">
            <legend>이미 있는 맵 {conflicts}개는 어떻게 하겠소?</legend>
            {POLICIES.map((p) => (
              <label key={p.value} className="policy-row">
                <input type="radio" name="policy" checked={policy === p.value} onChange={() => setPolicy(p.value)} />
                <span>
                  <b>{p.label}</b>
                  <span className="dim small"> — {p.desc}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="dialog-actions">
          <button className="btn ghost" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button className="btn primary" disabled={busy || plan.items.length === 0} onClick={() => onConfirm(policy)} autoFocus>
            {busy ? '가져오는 중…' : '가져오기'}
          </button>
        </div>
      </div>
    </div>
  );
}
