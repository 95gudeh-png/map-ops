import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeEditedMap } from './mapOps';
import type { GameMap } from './model';
import { SharePanel } from './share/SharePanel';
import { parseSessionHash, shareManager, useShareState } from './share/shareManager';
import { repo } from './store/repo';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useMaps } from './ui/hooks';
import { SelectView } from './ui/SelectView';
import { StorageView } from './ui/StorageView';
import { ViewerView } from './viewer/ViewerView';
import { emptyDraft } from './wizard/draft';
import { WizardView } from './wizard/WizardView';

type Route =
  | { view: 'select' }
  | { view: 'storage' }
  | { view: 'viewer'; mapId: string }
  | { view: 'wizard'; mode: 'create'; initial: GameMap }
  | { view: 'wizard'; mode: 'edit'; initial: GameMap };

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'select' });
  const [confirmExit, setConfirmExit] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const wizardDirty = useRef(false);
  const [joinRequest, setJoinRequest] = useState<{ id: string; secret: string } | null>(null);

  useEffect(() => {
    repo.init().then(
      () => {
        void shareManager.resume();
        setReady(true);
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  // 세션 링크(#session=...)로 열렸으면 참여 여부를 묻는다
  useEffect(() => {
    const check = () => {
      const req = parseSessionHash(location.hash);
      if (req) setJoinRequest(req);
      if (/^#(session|join)=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  const acceptJoin = async () => {
    if (!joinRequest) return;
    const { id, secret } = joinRequest;
    setJoinRequest(null);
    await shareManager.join(id, secret);
    setRoute({ view: 'select' });
    setShareOpen(true);
  };

  const toSelect = () => setRoute({ view: 'select' });

  const leaveWizard = useCallback(() => {
    setConfirmExit(false);
    wizardDirty.current = false;
    // 편집 취소는 그 맵의 사용 화면으로, 새 맵 취소는 목록으로
    setRoute((r) => (r.view === 'wizard' && r.mode === 'edit' ? { view: 'viewer', mapId: r.initial.id } : { view: 'select' }));
    // 저장하지 않은 마법사에서 올린 이미지 정리
    void repo.collectGarbageImages();
  }, []);

  const requestLeaveWizard = () => (wizardDirty.current ? setConfirmExit(true) : leaveWizard());
  const onDirtyChange = useCallback((d: boolean) => (wizardDirty.current = d), []);

  const saveWizard = async (map: GameMap) => {
    if (route.view === 'wizard' && route.mode === 'edit') repo.saveMap(mergeEditedMap(route.initial, map, repo.getMap(map.id)));
    else {
      await repo.createMap(map);
      shareManager.onMapCreated(map.id);
    }
    wizardDirty.current = false;
    setRoute({ view: 'viewer', mapId: map.id });
  };

  const maps = useMaps(); // 공유 상대의 변경도 즉시 반영되도록 구독
  const viewerMap = route.view === 'viewer' ? maps.find((m) => m.id === route.mapId) : undefined;
  const editMap = (map: GameMap) => setRoute({ view: 'wizard', mode: 'edit', initial: map });
  const share = useShareState();
  const syncText = !share.active
    ? '로컬'
    : share.status === 'online'
      ? `세션 공유 중 · ${share.peers.length}명 접속`
      : share.status === 'connecting'
        ? '연결 중…'
        : '연결 끊김(로컬 변경은 보존됨)';

  return (
    <>
      <header className="topbar">
        <div className="logo">
          MAP <span>OPS</span>
        </div>
        <div className="topbar-extra">
          {route.view === 'viewer' && (
            <button className="btn ghost" onClick={toSelect}>
              ← 맵 목록
            </button>
          )}
          {route.view === 'wizard' && (
            <button className="btn ghost" onClick={requestLeaveWizard}>
              ✕ 마법사 나가기
            </button>
          )}
          {route.view === 'select' && ready && (
            <button className="btn ghost" onClick={() => setRoute({ view: 'storage' })}>
              ⚙ 데이터 관리
            </button>
          )}
          {ready && (
            <button className={`btn small ${share.active ? 'sharing' : ''}`} onClick={() => setShareOpen((v) => !v)} aria-expanded={shareOpen}>
              {share.active ? `공유 중 · ${share.peers.length}명` : '세션 공유'}
            </button>
          )}
          <div className={`sync-state ${share.active ? share.status : 'local'}`} role="status">
            <span className="dot" />
            {syncText}
          </div>
        </div>
      </header>
      {shareOpen && (
        <div className="topbar-pop-anchor">
          <SharePanel currentMapId={viewerMap?.id} onClose={() => setShareOpen(false)} />
        </div>
      )}
      <main className={`app ${route.view === 'wizard' ? 'wide' : ''} ${route.view === 'viewer' ? 'full' : ''}`}>
        {/* 화면을 옮기면(key 변경) 오류 상태도 초기화된다 */}
        <ErrorBoundary key={route.view === 'viewer' ? `viewer:${route.mapId}` : route.view}>
          {ready && route.view === 'storage' && <StorageView onBack={toSelect} />}
          {error && <div className="notice error">저장소를 열지 못했소: {error}</div>}
          {!ready && !error && <p className="dim">불러오는 중…</p>}
          {ready && route.view === 'select' && (
            <SelectView
              onOpenMap={(mapId) => setRoute({ view: 'viewer', mapId })}
              onAddMap={() => setRoute({ view: 'wizard', mode: 'create', initial: emptyDraft() })}
              onEditMap={editMap}
            />
          )}
          {ready && route.view === 'viewer' &&
            (viewerMap ? (
              <ViewerView key={viewerMap.id} map={viewerMap} onEditMap={() => editMap(viewerMap)} />
            ) : (
              <p className="dim">맵을 찾을 수 없소. 삭제되었을 수 있소.</p>
            ))}
          {ready && route.view === 'wizard' && (
            <WizardView
              key={route.initial.id}
              initial={route.initial}
              mode={route.mode}
              onSave={saveWizard}
              onDirtyChange={onDirtyChange}
              onCancel={requestLeaveWizard}
            />
          )}
        </ErrorBoundary>
      </main>
      {ready && joinRequest && (
        <ConfirmDialog
          title="공유 세션에 참여"
          message={`세션 링크로 열렸소. 참여하면 링크를 보낸 사람의 브라우저와 직접(P2P) 연결되어 세션의 모든 맵을 함께 보고 고치게 되오.${
            shareManager.currentSessionId() && shareManager.currentSessionId() !== joinRequest.id ? ' 지금 참여 중인 다른 세션에서는 나가게 되오(맵은 남소).' : ''
          } 내 이름은 "${shareManager.getUser().name}"(으)로 보이오. 참여하겠소?`}
          confirmLabel="참여"
          onCancel={() => setJoinRequest(null)}
          onConfirm={() => void acceptJoin()}
        />
      )}
      {confirmExit && (
        <ConfirmDialog
          title="마법사 나가기"
          message="저장하지 않은 변경이 있소. 나가면 지금까지 한 작업이 사라지오. 나가겠소?"
          confirmLabel="나가기"
          danger
          onCancel={() => setConfirmExit(false)}
          onConfirm={leaveWizard}
        />
      )}
    </>
  );
}
