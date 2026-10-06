import { useEffect, useState } from 'react';
import { repo } from './store/repo';
import { SelectView } from './ui/SelectView';

type Route = { view: 'select' } | { view: 'viewer'; mapId: string } | { view: 'wizard' };

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'select' });

  useEffect(() => {
    repo.init().then(
      () => setReady(true),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const toSelect = () => setRoute({ view: 'select' });
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
            <button className="btn ghost" onClick={toSelect}>
              ✕ 마법사 나가기
            </button>
          )}
          <div className="sync-state" title="공유 기능은 M6에서 만들어지오">
            <span className="dot" />
            로컬
          </div>
        </div>
      </header>
      <main className="app">
        {error && <div className="notice error">저장소를 열지 못했소: {error}</div>}
        {!ready && !error && <p className="dim">불러오는 중…</p>}
        {ready && route.view === 'select' && (
          <SelectView onOpenMap={(mapId) => setRoute({ view: 'viewer', mapId })} onAddMap={() => setRoute({ view: 'wizard' })} />
        )}
        {ready && route.view === 'viewer' && (
          <p className="dim">
            {viewerMap ? `"${viewerMap.name}" 사용 화면은 M5에서 만들어지오.` : '맵을 찾을 수 없소.'}
          </p>
        )}
        {ready && route.view === 'wizard' && <p className="dim">맵 추가 마법사는 M3에서 만들어지오.</p>}
      </main>
    </>
  );
}
