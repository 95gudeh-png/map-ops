import { useRef, useState, useSyncExternalStore } from 'react';
import { shareManager } from '../share/shareManager';
import type { GameMap } from '../model';
import { exportMapToFile, importMapopsFile } from '../store/exportImport';
import { repo } from '../store/repo';
import { ConfirmDialog } from './ConfirmDialog';
import { useMaps } from './hooks';
import { MapCard } from './MapCard';

interface Props {
  onOpenMap: (id: string) => void;
  onAddMap: () => void;
  onEditMap: (map: GameMap) => void;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function SelectView({ onOpenMap, onAddMap, onEditMap }: Props) {
  const maps = useMaps();
  const pending = useSyncExternalStore(repo.subscribe, repo.getPendingIds);
  const [pendingDelete, setPendingDelete] = useState<GameMap | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice({ kind: 'ok', text: msg });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onImport = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (fileRef.current) fileRef.current.value = '';
    if (list.length === 0) return;
    void run(async () => {
      const names: string[] = [];
      for (const f of list) names.push((await importMapopsFile(f)).name);
      return `가져왔소: ${names.join(', ')}`;
    });
  };

  const onSample = () =>
    run(async () => {
      const { createSampleMap } = await import('../dev/sampleMap');
      const map = await createSampleMap();
      await repo.createMap(map);
      return `샘플 맵을 만들었소: ${map.name}`;
    });

  return (
    <div>
      <div className="section-head">
        <h2>맵 목록</h2>
        <div className="section-actions">
          {import.meta.env.DEV && (
            <button className="btn small" onClick={onSample} disabled={busy}>
              샘플 맵 생성 (개발용)
            </button>
          )}
          <button className="btn small" onClick={() => fileRef.current?.click()} disabled={busy}>
            가져오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".mapops,application/json"
            multiple
            hidden
            onChange={(e) => onImport(e.target.files)}
          />
        </div>
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          {notice.text}
          <button className="icon-btn" aria-label="알림 닫기" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="grid">
        {maps.map((m) => (
          <MapCard
            key={m.id}
            map={m}
            onOpen={() => onOpenMap(m.id)}
            onEdit={() => onEditMap(m)}
            onExport={() => run(async () => exportMapToFile(m))}
            onDelete={() => setPendingDelete(m)}
          />
        ))}
        <button className="addcard" onClick={onAddMap}>
          <div className="plus">+</div>
          <div>맵 추가</div>
        </button>
      </div>
      {pending.length > 0 && (
        <div className="notice ok pending-note" role="status">
          공유 맵 {pending.length}개를 받는 중이오. 링크를 보낸 사람이 접속해 있어야 내용이 도착하오.
          <button className="btn small ghost" onClick={() => pending.forEach((id) => {
              shareManager.stop(id);
              void repo.deleteMap(id);
            })}>
            참여 취소
          </button>
        </div>
      )}
      {maps.length === 0 && <div className="emptynote">등록된 맵이 없소. "맵 추가"로 시작하거나 .mapops 파일을 가져오시오.</div>}

      {pendingDelete && (
        <ConfirmDialog
          title="맵 삭제"
          message={`"${pendingDelete.name}"을(를) 삭제하겠소? 층 ${pendingDelete.floors.length}개와 마커 ${pendingDelete.markers.length}개가 함께 지워지며 되돌릴 수 없소. 필요하면 먼저 내보내기로 백업하시오.`}
          confirmLabel="삭제"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void run(async () => {
              shareManager.stop(target.id);
              await repo.deleteMap(target.id);
              return `삭제했소: ${target.name}`;
            });
          }}
        />
      )}
    </div>
  );
}
