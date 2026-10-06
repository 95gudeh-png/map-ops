import { useRef, useState, type DragEvent } from 'react';
import type { GameMap, Id } from '../model';
import { putImage } from '../store/imageStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useImageUrl } from '../ui/hooks';
import { addFloor, baseName, deleteFloor, moveFloor, renameFloor, replaceImage, setAnchor } from './draft';

const FLOOR_DRAG_TYPE = 'application/x-mapops-floor';

interface Props {
  draft: GameMap;
  onChange: (d: GameMap) => void;
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}

export function FloorListStep({ draft, onChange, onBack, onNext, nextLabel }: Props) {
  const multiRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [dropHint, setDropHint] = useState(false);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: Id; name: string; markers: number } | null>(null);
  // 비동기 업로드 중에도 최신 초안에 덧붙이기 위한 참조
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const addFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      if (files.length) setMessage({ kind: 'error', text: '이미지 파일만 올릴 수 있소.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const failed: string[] = [];
    let d = draftRef.current;
    for (const file of images) {
      try {
        const rec = await putImage(file);
        d = addFloor(d, rec, baseName(file.name));
      } catch {
        failed.push(file.name);
      }
    }
    onChange(d);
    setBusy(false);
    if (failed.length) setMessage({ kind: 'error', text: `읽지 못한 파일: ${failed.join(', ')}` });
  };

  const replace = async (floorId: Id, file: File) => {
    setBusy(true);
    try {
      const rec = await putImage(file);
      const r = replaceImage(draftRef.current, floorId, rec);
      onChange(r.draft);
      setMessage(
        r.aspectWarning
          ? { kind: 'error', text: '새 이미지의 가로세로 비율이 달라 정렬이 어긋날 수 있소. 3단계에서 이 층을 다시 맞추시오.' }
          : null,
      );
    } catch {
      setMessage({ kind: 'error', text: `읽지 못한 파일: ${file.name}` });
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (id: Id, name: string) => {
    const markers = draft.markers.filter((m) => m.scope.kind === 'floor' && m.scope.floorId === id).length;
    if (markers > 0) setPendingDelete({ id, name, markers });
    else onChange(deleteFloor(draft, id).draft);
  };

  // 페이지에 파일을 끌어다 놓기(층 순서 드래그와 구분)
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onPageDragOver = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDropHint(true);
  };
  const onPageDrop = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDropHint(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className={`wizard-step ${dropHint ? 'drop-hint' : ''}`}
      onDragOver={onPageDragOver}
      onDragLeave={(e) => e.currentTarget === e.target && setDropHint(false)}
      onDrop={onPageDrop}
    >
      <h3>2. 층별 단면도 업로드</h3>
      <p className="step-note">
        각 층의 단면도 이미지를 올리시오. 이 화면에 파일을 끌어다 놓아도 되오. ★ 표시된 층이 전체 좌표의 기준이 되며, 다른
        층들은 이 층을 기준으로 맞춰지오.
      </p>

      {draft.floors.length > 0 && (
        <p className="hint">⠿ 을(를) 끌어 순서를 바꾸고(정렬 진행 순서·탭 순서), ☆를 눌러 기준층을 바꿀 수 있소.</p>
      )}

      <ol className="floor-list">
        {draft.floors.map((f, i) => (
          <FloorRow
            key={f.id}
            index={i}
            name={f.name}
            imageId={f.imageId}
            size={`${f.imageW}×${f.imageH}`}
            isAnchor={f.id === draft.anchorFloorId}
            dragOver={dragOver === i}
            onRename={(name) => onChange(renameFloor(draft, f.id, name))}
            onAnchor={() => onChange(setAnchor(draft, f.id))}
            onReplace={(file) => replace(f.id, file)}
            onDelete={() => requestDelete(f.id, f.name)}
            onDragStartHandle={(e) => {
              e.dataTransfer.setData(FLOOR_DRAG_TYPE, String(i));
              e.dataTransfer.effectAllowed = 'move';
              const row = (e.currentTarget as HTMLElement).closest('li');
              if (row) e.dataTransfer.setDragImage(row, 20, 20);
            }}
            onDragOverRow={(e) => {
              if (!e.dataTransfer.types.includes(FLOOR_DRAG_TYPE)) return;
              e.preventDefault();
              setDragOver(i);
            }}
            onDropRow={(e) => {
              const from = e.dataTransfer.getData(FLOOR_DRAG_TYPE);
              setDragOver(null);
              if (from === '') return;
              e.preventDefault();
              e.stopPropagation();
              onChange(moveFloor(draft, Number(from), i));
            }}
            onDragEnd={() => setDragOver(null)}
          />
        ))}
      </ol>

      {draft.floors.length === 0 && (
        <button className="upload-empty" onClick={() => multiRef.current?.click()} disabled={busy}>
          <div className="plus">+</div>
          <div>이미지 선택 (여러 장 가능)</div>
          <div className="dim">또는 이 화면에 파일을 끌어다 놓으시오</div>
        </button>
      )}

      <div className="row-actions">
        <button className="btn small" onClick={() => multiRef.current?.click()} disabled={busy}>
          + 이미지로 층 추가 (여러 장 가능)
        </button>
        {busy && <span className="dim">처리 중…</span>}
      </div>
      <input
        ref={multiRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void addFiles(files);
        }}
      />
      <p className="hint">파일 선택 창에서 Ctrl 또는 Shift를 누른 채 여러 장을 고르면 한 번에 층이 만들어지오. 이름은 파일명으로 정해지며 바로 고칠 수 있소.</p>

      {message && <div className={`notice ${message.kind}`}>{message.text}</div>}

      <div className="wizard-actions">
        <button className="btn ghost" onClick={onBack}>
          이전
        </button>
        <button className="btn primary" onClick={onNext} disabled={draft.floors.length === 0 || busy}>
          {nextLabel}
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="층 삭제"
          message={`"${pendingDelete.name}"을(를) 지우면 이 층에만 있는 마커 ${pendingDelete.markers}개도 함께 지워지오. 계속하겠소?`}
          confirmLabel="삭제"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            onChange(deleteFloor(draft, pendingDelete.id).draft);
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

interface RowProps {
  index: number;
  name: string;
  imageId: string;
  size: string;
  isAnchor: boolean;
  dragOver: boolean;
  onRename: (name: string) => void;
  onAnchor: () => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
  onDragStartHandle: (e: DragEvent) => void;
  onDragOverRow: (e: DragEvent) => void;
  onDropRow: (e: DragEvent) => void;
  onDragEnd: () => void;
}

function FloorRow(p: RowProps) {
  const thumb = useImageUrl(p.imageId);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <li
      className={`floor-row ${p.isAnchor ? 'anchor' : ''} ${p.dragOver ? 'drag-over' : ''}`}
      onDragOver={p.onDragOverRow}
      onDrop={p.onDropRow}
    >
      <span className="handle" draggable onDragStart={p.onDragStartHandle} onDragEnd={p.onDragEnd} title="끌어서 순서 변경" aria-hidden>
        ⠿
      </span>
      <button
        className={`star ${p.isAnchor ? 'on' : ''}`}
        onClick={p.onAnchor}
        title={p.isAnchor ? '기준층' : '이 층을 기준층으로 지정'}
        aria-label={p.isAnchor ? '기준층' : '기준층으로 지정'}
        aria-pressed={p.isAnchor}
      >
        {p.isAnchor ? '★' : '☆'}
      </button>
      <div className="thumb-sm">{thumb && <img src={thumb} alt="" />}</div>
      <input className="fname" type="text" value={p.name} onChange={(e) => p.onRename(e.target.value)} aria-label={`${p.index + 1}번째 층 이름`} />
      <span className="dim size">{p.size}</span>
      <button className="btn small" onClick={() => fileRef.current?.click()}>
        이미지 변경
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) p.onReplace(f);
        }}
      />
      <button className="btn small ghost" onClick={p.onDelete}>
        삭제
      </button>
    </li>
  );
}
