/** 데이터 관리: 사용량 확인, 맵별 정리, 미사용 이미지 정리, 이 기기 설정 초기화, 전체 삭제. */
import { useCallback, useEffect, useState } from 'react';
import type { GameMap } from '../model';
import { shareManager } from '../share/shareManager';
import { exportMapsToFile, exportMapToFile } from '../store/exportImport';
import { imageSizes } from '../store/imageStore';
import { repo } from '../store/repo';
import { ConfirmDialog } from './ConfirmDialog';
import { useMaps } from './hooks';

const LOCAL_PREFIX = 'mapops.';
const WIPE_WORD = '모두 삭제';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface Usage {
  usage?: number;
  quota?: number;
  persisted?: boolean;
  images: Map<string, number>;
}

interface Props {
  onBack: () => void;
}

export function StorageView({ onBack }: Props) {
  const maps = useMaps();
  const [info, setInfo] = useState<Usage | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GameMap | null>(null);
  const [confirmPrefs, setConfirmPrefs] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeText, setWipeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelete, setBulkDelete] = useState(false);
  // 지워졌거나 새로 생긴 맵을 반영(목록에 있는 것만 선택으로 침)
  const selectedMaps = maps.filter((m) => selected.has(m.id));

  const refresh = useCallback(async () => {
    const est = (await navigator.storage?.estimate?.().catch(() => undefined)) ?? {};
    const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
    setInfo({ usage: est.usage, quota: est.quota, persisted, images: await imageSizes() });
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, maps]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ kind: 'ok', text: await fn() });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  // 이미지가 여러 맵에서 같이 쓰이면 각 맵에 모두 셈(삭제해도 다른 맵이 쓰면 남음)
  const usedBy = new Map<string, number>();
  for (const m of maps) for (const id of new Set(m.floors.map((f) => f.imageId))) usedBy.set(id, (usedBy.get(id) ?? 0) + 1);
  const mapImageBytes = (m: GameMap) => [...new Set(m.floors.map((f) => f.imageId))].reduce((s, id) => s + (info?.images.get(id) ?? 0), 0);
  const unusedBytes = info ? [...info.images].filter(([id]) => !usedBy.has(id)).reduce((s, [, b]) => s + b, 0) : 0;
  const unusedCount = info ? [...info.images.keys()].filter((id) => !usedBy.has(id)).length : 0;

  const localKeys = () => {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(LOCAL_PREFIX));
    } catch {
      return [];
    }
  };

  const wipe = async () => {
    setBusy(true);
    const sessionDbs = shareManager.dbNames();
    await shareManager.closeAll();
    for (const k of localKeys()) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* 무시 */
      }
    }
    await repo.wipeAll(sessionDbs);
    location.reload();
  };

  return (
    <div className="storage-view">
      <div className="section-head">
        <h2>데이터 관리</h2>
        <button className="btn small ghost" onClick={onBack}>
          ← 맵 목록
        </button>
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          {notice.text}
          <button className="icon-btn" aria-label="알림 닫기" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <section className="card">
        <h3>이 브라우저의 사용량</h3>
        <p className="big">
          {info?.usage !== undefined ? formatBytes(info.usage) : '…'}
          {info?.quota ? <span className="dim"> / 사용 가능 {formatBytes(info.quota)}</span> : null}
        </p>
        <p className="hint">
          MAP OPS의 데이터는 이 브라우저의 사이트 데이터(IndexedDB)에 저장되오. 창을 닫아도 남지만, 브라우저 설정에서 "쿠키 및 기타 사이트
          데이터"를 지우면 함께 지워지오.
        </p>
        <div className="row-actions">
          {info?.persisted ? (
            <span className="badge ok">영구 저장 사용 중 — 공간이 부족해도 브라우저가 임의로 지우지 않소</span>
          ) : (
            <>
              <span className="badge">일반 저장 — 공간이 아주 부족하면 브라우저가 정리할 수 있소</span>
              <button
                className="btn small"
                disabled={busy || !navigator.storage?.persist}
                onClick={() =>
                  run(async () =>
                    (await navigator.storage.persist())
                      ? '영구 저장이 허용되었소.'
                      : '브라우저가 거절했소. 이 사이트를 즐겨찾기에 추가하거나 자주 쓰면 나중에 허용될 수 있소.',
                  )
                }
              >
                영구 저장 요청
              </button>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <h3>맵별 데이터 ({maps.length}개)</h3>
        {maps.length > 0 && (
          <div className="bulk-bar">
            <span className="dim small">선택 {selectedMaps.length}개</span>
            <button
              className="btn small"
              disabled={busy || selectedMaps.length === 0}
              onClick={() => run(async () => (await exportMapsToFile(selectedMaps), `맵 ${selectedMaps.length}개를 파일 하나로 내보냈소.`))}
            >
              선택 내보내기
            </button>
            <button className="btn small ghost danger-text" disabled={busy || selectedMaps.length === 0} onClick={() => setBulkDelete(true)}>
              선택 삭제
            </button>
            <span className="spacer" />
            <button className="btn small" disabled={busy} onClick={() => run(async () => (await exportMapsToFile(maps), `맵 ${maps.length}개를 파일 하나로 내보냈소.`))}>
              모두 내보내기
            </button>
          </div>
        )}
        {maps.length === 0 ? (
          <p className="dim">저장된 맵이 없소.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="sel">
                  <input
                    type="checkbox"
                    aria-label="모두 선택"
                    checked={selectedMaps.length === maps.length}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedMaps.length > 0 && selectedMaps.length < maps.length;
                    }}
                    onChange={(e) => setSelected(new Set(e.target.checked ? maps.map((m) => m.id) : []))}
                  />
                </th>
                <th>맵</th>
                <th>층</th>
                <th>마커</th>
                <th>낙서</th>
                <th>이미지</th>
                <th>내용</th>
                <th aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {maps.map((m) => (
                <tr key={m.id} className={selected.has(m.id) ? 'selected' : ''}>
                  <td className="sel">
                    <input
                      type="checkbox"
                      aria-label={`${m.name} 선택`}
                      checked={selected.has(m.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(m.id);
                        else next.delete(m.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>
                    {m.name}
                    {shareManager.isIncluded(m.id) && <span className="badge small">세션</span>}
                  </td>
                  <td>{m.floors.length}</td>
                  <td>{m.markers.length}</td>
                  <td>{m.strokes?.length ?? 0}</td>
                  <td>{info ? formatBytes(mapImageBytes(m)) : '…'}</td>
                  <td>{formatBytes(repo.docBytes(m.id))}</td>
                  <td className="actions">
                    <button className="btn small" disabled={busy} onClick={() => run(async () => (await exportMapToFile(m), `내보냈소: ${m.name}`))}>
                      내보내기
                    </button>
                    <button className="btn small ghost danger-text" disabled={busy} onClick={() => setPendingDelete(m)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">같은 이미지를 여러 맵이 쓰면 각 맵에 모두 표시되며, 마지막으로 쓰는 맵을 지울 때 실제로 지워지오.</p>
      </section>

      <section className="card">
        <h3>정리</h3>
        <div className="cleanup-row">
          <div>
            <b>쓰지 않는 이미지</b>
            <div className="dim">
              {unusedCount}장 · {formatBytes(unusedBytes)} — 지운 맵이나 저장하지 않은 마법사에서 남은 이미지
            </div>
          </div>
          <button
            className="btn small"
            disabled={busy || unusedCount === 0}
            onClick={() => run(async () => `이미지 ${await repo.collectGarbageImages()}장을 지웠소.`)}
          >
            정리
          </button>
        </div>
        <div className="cleanup-row">
          <div>
            <b>이 기기 설정 초기화</b>
            <div className="dim">십자선·펜·공유 이름·릴레이 설정을 기본값으로(맵은 그대로)</div>
          </div>
          <button className="btn small" disabled={busy || localKeys().length === 0} onClick={() => setConfirmPrefs(true)}>
            초기화
          </button>
        </div>
      </section>

      <section className="card danger-zone">
        <h3>모든 데이터 삭제</h3>
        <p className="hint">
          이 브라우저의 MAP OPS 맵·이미지·마커·낙서·설정을 모두 지우오. 되돌릴 수 없으니 남길 맵은 먼저 내보내시오. 공유 중인 맵은 친구 쪽
          사본에는 영향이 없소.
        </p>
        {!wipeOpen ? (
          <button className="btn small danger" disabled={busy} onClick={() => setWipeOpen(true)}>
            모든 데이터 삭제…
          </button>
        ) : (
          <div className="wipe-confirm">
            <label>
              확인을 위해 <b>{WIPE_WORD}</b>를 입력하시오
              <input className="text-input" value={wipeText} onChange={(e) => setWipeText(e.target.value)} autoFocus />
            </label>
            <div className="row-actions">
              <button
                className="btn small ghost"
                onClick={() => {
                  setWipeOpen(false);
                  setWipeText('');
                }}
              >
                취소
              </button>
              <button className="btn small danger" disabled={busy || wipeText.trim() !== WIPE_WORD} onClick={() => void wipe()}>
                영구 삭제
              </button>
            </div>
          </div>
        )}
      </section>

      {bulkDelete && (
        <ConfirmDialog
          title={`맵 ${selectedMaps.length}개 삭제`}
          message={`${selectedMaps.map((m) => `"${m.name}"`).join(', ')}을(를) 삭제하겠소? 마커와 낙서가 함께 지워지며 되돌릴 수 없소. 공유 세션에서도 빠지오(친구가 받은 사본은 남소). 필요하면 먼저 "선택 내보내기"로 백업하시오.`}
          confirmLabel="모두 삭제"
          danger
          onCancel={() => setBulkDelete(false)}
          onConfirm={() => {
            const targets = selectedMaps;
            setBulkDelete(false);
            void run(async () => {
              for (const m of targets) {
                shareManager.onMapDeleted(m.id);
                await repo.deleteMap(m.id);
              }
              setSelected(new Set());
              return `맵 ${targets.length}개를 삭제했소.`;
            });
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="맵 삭제"
          message={`"${pendingDelete.name}"을(를) 삭제하겠소? 층 ${pendingDelete.floors.length}개, 마커 ${pendingDelete.markers.length}개, 낙서 ${pendingDelete.strokes?.length ?? 0}개가 함께 지워지며 되돌릴 수 없소.`}
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
      {confirmPrefs && (
        <ConfirmDialog
          title="이 기기 설정 초기화"
          message="십자선·펜·공유 이름·릴레이 설정을 기본값으로 되돌리겠소? 맵 데이터는 지워지지 않소."
          confirmLabel="초기화"
          onCancel={() => setConfirmPrefs(false)}
          onConfirm={() => {
            setConfirmPrefs(false);
            for (const k of localKeys()) {
              try {
                localStorage.removeItem(k);
              } catch {
                /* 무시 */
              }
            }
            setNotice({ kind: 'ok', text: '이 기기 설정을 초기화했소. 새로 연 화면부터 적용되오.' });
          }}
        />
      )}
    </div>
  );
}
