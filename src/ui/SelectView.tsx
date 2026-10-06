import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { findDuplicateGroups } from '../mapMerge';
import { isLocalHost, PUBLIC_APP_URL, shareManager } from '../share/shareManager';
import type { GameMap } from '../model';
import { DuplicateDialog } from './DuplicateDialog';
import {
  applyImport,
  describeImport,
  exportMapsToFile,
  exportMapToFile,
  planImport,
  type ImportPlan,
  type ImportPolicy,
} from '../store/exportImport';
import { ImportDialog } from './ImportDialog';
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

/* "이대로 두기"를 고른 중복 그룹(맵 ID 묶음) — 기기별로 기억해 다시 묻지 않는다 */
const IGNORE_KEY = 'mapops.ignoredDuplicates';
const groupKey = (g: GameMap[]) => g.map((m) => m.id).sort().join(',');
function loadIgnored(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(IGNORE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveIgnored(keys: string[]) {
  try {
    localStorage.setItem(IGNORE_KEY, JSON.stringify(keys));
  } catch {
    /* 무시 */
  }
}

export function SelectView({ onOpenMap, onAddMap, onEditMap }: Props) {
  const maps = useMaps();
  const pending = useSyncExternalStore(repo.subscribe, repo.getPendingIds);
  const [pendingDelete, setPendingDelete] = useState<GameMap | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ignored, setIgnored] = useState<string[]>(loadIgnored);
  const [dupOpen, setDupOpen] = useState(false);
  const duplicates = useMemo(() => findDuplicateGroups(maps).filter((g) => !ignored.includes(groupKey(g))), [maps, ignored]);
  const local = isLocalHost(location.hostname);

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

  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);

  /** 여러 파일·묶음 파일을 한 번에. 먼저 읽어서 확인 창을 띄우고, 고른 방식대로 가져온다. */
  const onImport = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (fileRef.current) fileRef.current.value = '';
    if (list.length === 0) return;
    void run(async () => {
      const plan = await planImport(list);
      if (plan.items.length === 0) throw new Error(plan.errors.join(' / ') || '가져올 맵이 없소.');
      setImportPlan(plan);
    });
  };

  const confirmImport = (policy: ImportPolicy) => {
    const plan = importPlan;
    if (!plan) return;
    void run(async () => {
      const r = await applyImport(plan, policy);
      for (const id of r.createdIds) shareManager.onMapCreated(id);
      setImportPlan(null);
      return describeImport(r) + (plan.errors.length ? ` 읽지 못한 파일 ${plan.errors.length}개.` : '');
    });
  };

  const onSample = () =>
    run(async () => {
      const { createSampleMap } = await import('../dev/sampleMap');
      const map = await createSampleMap();
      await repo.createMap(map);
      shareManager.onMapCreated(map.id);
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
          <button className="btn small" onClick={() => fileRef.current?.click()} disabled={busy} title="여러 파일을 한 번에 고를 수 있소">
            가져오기
          </button>
          <button
            className="btn small"
            onClick={() => run(async () => (await exportMapsToFile(maps), `맵 ${maps.length}개를 파일 하나로 내보냈소.`))}
            disabled={busy || maps.length === 0}
            title="모든 맵을 .mapops 파일 하나로(골라서 내보내려면 ⚙ 데이터 관리)"
          >
            모두 내보내기
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

      {local && (
        <div className="notice warn-note" role="note">
          <span>
            지금은 <b>이 컴퓨터 전용 주소(localhost)</b>로 열려 있소. 여기 맵은 공개 사이트와 <b>따로 저장</b>되오. 같은 맵을 양쪽에서 따로 만들면
            공유할 때 중복으로 보이니, 평소에는 공개 사이트 한 곳에서 쓰시오(옮길 땐 내보내기 → 가져오기).
          </span>
          <a className="btn small" href={PUBLIC_APP_URL}>
            공개 사이트 열기
          </a>
        </div>
      )}
      {duplicates.length > 0 && (
        <div className="notice warn-note" role="status">
          <span>
            같은 단면도로 만든 맵이 <b>{duplicates.length}묶음</b> 겹쳐 있소({duplicates.map((g) => `${g[0]!.name} ×${g.length}`).join(', ')}).
          </span>
          <button className="btn small primary" onClick={() => setDupOpen(true)}>
            정리하기
          </button>
        </div>
      )}
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
          세션의 맵 {pending.length}개를 받는 중이오. 그 맵을 가진 사람이 접속해 있어야 내용이 도착하오.
        </div>
      )}
      {maps.length === 0 && <div className="emptynote">등록된 맵이 없소. "맵 추가"로 시작하거나 .mapops 파일을 가져오시오.</div>}

      {importPlan && <ImportDialog plan={importPlan} busy={busy} onConfirm={confirmImport} onCancel={() => setImportPlan(null)} />}
      {dupOpen && duplicates.length > 0 && (
        <DuplicateDialog
          groups={duplicates}
          onCancel={() => setDupOpen(false)}
          onIgnore={(groups) => {
            const next = [...ignored, ...groups.map(groupKey)];
            saveIgnored(next);
            setIgnored(next);
            setDupOpen(false);
          }}
          onDone={(text) => {
            setDupOpen(false);
            setNotice({ kind: text.includes('오류') ? 'error' : 'ok', text });
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="맵 삭제"
          message={`"${pendingDelete.name}"을(를) 삭제하겠소? 층 ${pendingDelete.floors.length}개와 마커 ${pendingDelete.markers.length}개가 함께 지워지며 되돌릴 수 없소.${
            shareManager.isIncluded(pendingDelete.id) ? ' 공유 세션에서도 빠지오(친구가 이미 받은 사본은 남소).' : ''
          } 필요하면 먼저 내보내기로 백업하시오.`}
          confirmLabel="삭제"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete;
            setPendingDelete(null);
            void run(async () => {
              shareManager.onMapDeleted(target.id);
              await repo.deleteMap(target.id);
              return `삭제했소: ${target.name}`;
            });
          }}
        />
      )}
    </div>
  );
}
