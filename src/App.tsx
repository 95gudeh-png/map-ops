import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMap } from './model';
import { repo } from './store/repo';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SelectView } from './ui/SelectView';
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

  useEffect(() => {
    repo.init().then(
      () => setReady(true),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const toSelect = () => setRoute({ view: 'select' });

  const leaveWizard = useCallback(() => {
    setConfirmExit(false);
    wizardDirty.current = false;
    setRoute({ view: 'select' });
    // 저장하지 않은 마법사에서 올린 이미지 정리
    void repo.collectGarbageImages();
  }, []);

  const requestLeaveWizard = () => (wizardDirty.current ? setConfirmExit(true) : leaveWizard());
  const onDirtyChange = useCallback((d: boolean) => (wizardDirty.current = d), []);

  const saveWizard = async (map: GameMap) => {
    if (route.view === 'wizard' && route.mode === 'edit') repo.saveMap(map);
    else await repo.createMap(map);
    wizardDirty.current = false;
    setRoute({ view: 'viewer', mapId: map.id });
  };

  const viewerMap = route.view === 'viewer' ? repo.getMap(route.mapId) : undefined;

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
          <div className="sync-state" title="공유 기능은 M6에서 만들어지오">
            <span className="dot" />
            로컬
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
          />
        )}
        {ready && route.view === 'viewer' && (
          <p className="dim">
            {viewerMap ? `"${viewerMap.name}" 사용 화면은 M5에서 만들어지오.` : '맵을 찾을 수 없소.'}
          </p>
        )}
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
