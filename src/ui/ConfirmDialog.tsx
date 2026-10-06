import { useEffect } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h3 id="dlg-title">{title}</h3>
        <p>{message}</p>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onCancel}>
            취소
          </button>
          <button className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
