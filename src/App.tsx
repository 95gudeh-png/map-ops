import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeEditedMap } from './mapOps';
import type { GameMap } from './model';
import { parseJoinHash, shareManager, useShareState } from './share/shareManager';
import { repo } from './store/repo';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useMaps } from './ui/hooks';
import { SelectView } from './ui/SelectView';
import { ViewerView } from './viewer/ViewerView';
import { emptyDraft } from './wizard/draft';
import { WizardView } from './wizard/WizardView';

type Route =
  | { view: 'select' }
  | { view: 'viewer'; mapId: string }
  | { view: 'wizard'; mode: 'create'; initial: GameMap }
  | { view: 'wizard'; mode: 'edit'; initial: GameMap };

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'select' });
  const [confirmExit, setConfirmExit] = useState(false);
  const wizardDirty = useRef(false);
  const [joinRequest, setJoinRequest] = useState<{ mapId: string; secret: string } | null>(null);

  useEffect(() => {
    repo.init().then(
      () => {
        shareManager.resumeAll();
        setReady(true);
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  // 공유 링크(#join=...)로 열렸으면 참여 여부를 묻는다
  useEffect(() => {
    const check = () => {
      const req = parseJoinHash(location.hash);
      if (req) setJoinRequest(req);
      if (location.hash.startsWith('#join=')) history.replaceState(null, '', location.pathname + location.search);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  const acceptJoin = async () => {
    if (!joinRequest) return;
    const { mapId, secret } = joinRequest;
    setJoinRequest(null);
    await shareManager.join(mapId, secret);
    setRoute(repo.getMap(mapId) ? { view: 'viewer', mapId } : { view: 'select' });
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
    else await repo.createMap(map);
    wizardDirty.current = false;
    setRoute({ view: 'viewer', mapId: map.id });
  };

  const maps = useMaps(); // 공유 상대의 변경도 즉시 반영되도록 구독
  const viewerMap = route.view === 'viewer' ? maps.find((m) => m.id === route.mapId) : undefined;
  const editMap = (map: GameMap) => setRoute({ view: 'wizard', mode: 'edit', initial: map });
  const shareState = useShareState(viewerMap?.id);
  const syncText =
    shareState.status === 'local'
      ? '로컬'
      : shareState.status === 'online'
        ? `공유 중 · ${shareState.peers.length}명 접속`
        : shareState.status === 'connecting'
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
          <div className={`sync-state ${shareState.status}`} role="status">
            <span className="dot" />
            {syncText}
          </div>
        </div>
      </header>
      <main className={`app ${route.view === 'wizard' ? 'wide' : ''}`}>
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
      </main>
      {ready && joinRequest && (
        <ConfirmDialog
          title="공유 맵에 참여"
          message={`공유 링크로 열렸소. 참여하면 링크를 보낸 사람의 브라우저와 직접(P2P) 연결되어 맵을 함께 보고 고치게 되오. 내 이름은 "${shareManager.getUser().name}"(으)로 보이오. 참여하겠소?`}
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
