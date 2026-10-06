import { useEffect, useRef, useState } from 'react';
import type { GameMap } from '../model';
import { CalibrateStep } from './CalibrateStep';
import { FloorListStep } from './FloorListStep';

interface Props {
  /** 편집 모드면 기존 맵, 새 맵이면 빈 초안. */
  initial: GameMap;
  mode: 'create' | 'edit';
  /** 편집 모드에서 바로 정렬 단계로 들어갈 때. */
  startStep?: 1 | 2 | 3;
  onSave: (map: GameMap) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
}

export function WizardView({ initial, mode, startStep = 1, onSave, onDirtyChange, onCancel }: Props) {
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState<1 | 2 | 3>(startStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [nameInvalid, setNameInvalid] = useState(false);

  useEffect(() => {
    onDirtyChange(draft !== initial);
  }, [draft, initial, onDirtyChange]);

  useEffect(() => {
    if (step === 1) nameRef.current?.focus();
  }, [step]);

  const save = async (final: GameMap = draft) => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...final, name: final.name.trim(), updatedAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const toStep2 = () => {
    if (!draft.name.trim()) {
      setNameInvalid(true);
      nameRef.current?.focus();
      return;
    }
    setStep(2);
  };

  const single = draft.floors.length <= 1;
  const finishLabel = mode === 'edit' ? '완료 · 변경 저장' : '완료 · 맵 저장';

  return (
    <div className="wizard-box">
      <ol className="wizard-steps" aria-label="진행 단계">
        {['이름', '층 업로드', '정렬'].map((label, i) => (
          <li key={label} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="wizard-step">
          <h3>1. 맵 이름</h3>
          <p className="step-note">{mode === 'edit' ? '맵 이름을 고칠 수 있소.' : '새로 추가할 맵의 이름을 입력하시오.'}</p>
          <input
            ref={nameRef}
            className={`text-input ${nameInvalid ? 'invalid' : ''}`}
            type="text"
            value={draft.name}
            placeholder="예: 은행"
            aria-invalid={nameInvalid}
            onChange={(e) => {
              setNameInvalid(false);
              setDraft({ ...draft, name: e.target.value });
            }}
            onKeyDown={(e) => e.key === 'Enter' && toStep2()}
          />
          {nameInvalid && <p className="field-error">이름을 입력하시오.</p>}
          <div className="wizard-actions">
            <button className="btn ghost" onClick={onCancel}>
              취소
            </button>
            <button className="btn primary" onClick={toStep2}>
              다음
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <FloorListStep
          draft={draft}
          onChange={setDraft}
          onBack={() => setStep(1)}
          onNext={() => (single ? void save() : setStep(3))}
          nextLabel={single ? finishLabel : '다음: 정렬'}
        />
      )}

      {step === 3 && !single && (
        <CalibrateStep draft={draft} onChange={setDraft} onBack={() => setStep(2)} onFinish={(final) => void save(final)} finishLabel={finishLabel} />
      )}

      {saving && <p className="dim">저장 중…</p>}
      {error && <div className="notice error">저장하지 못했소: {error}</div>}
    </div>
  );
}
