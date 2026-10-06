import { useState } from 'react';
import type { Id } from '../model';
import { useMaps } from '../ui/hooks';
import { getRelays, isLocalHost, shareManager, useShareState } from './shareManager';

interface Props {
  /** 지금 보고 있는 맵(있으면 목록에서 강조). */
  currentMapId?: Id;
  onClose: () => void;
}

const STATUS_TEXT = {
  local: '공유 안 함',
  connecting: '릴레이에 연결 중…',
  online: '세션 공유 중',
  offline: '연결 끊김(로컬 변경은 보존됨)',
} as const;

/** 세션 단위 공유 창: 시작·링크·접속자·포함할 맵·나가기. */
export function SharePanel({ currentMapId, onClose }: Props) {
  const state = useShareState();
  const maps = useMaps();
  const [user, setUser] = useState(shareManager.getUser());
  const [copied, setCopied] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [relays, setRelays] = useState(getRelays().join('\n'));
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const link = shareManager.link();

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const saveUser = () => shareManager.setUser({ ...user, name: user.name.trim() || shareManager.getUser().name });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="popover share-pop" role="dialog" aria-label="세션 공유" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="form-head">
        <div className="form-title">세션 공유</div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>

      <label className="field">
        내 이름
        <span className="name-row">
          <input type="color" value={user.color} onChange={(e) => setUser({ ...user, color: e.target.value })} onBlur={saveUser} aria-label="내 색" />
          <input className="text-input" type="text" value={user.name} maxLength={20} onChange={(e) => setUser({ ...user, name: e.target.value })} onBlur={saveUser} />
        </span>
      </label>

      {!state.active ? (
        <>
          <p className="hint">
            세션을 시작하면 링크 하나로 <b>모든 맵</b>(층 이미지·정렬·마커·낙서)을 친구와 실시간으로 함께 쓰오. 공유 중에 새로 만든 맵도 자동으로
            들어가며, 원치 않는 맵은 나중에 빼면 되오. 서버 없이 브라우저끼리 직접 연결되므로 <b>양쪽이 동시에 접속해 있어야</b> 주고받소.
          </p>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                saveUser();
                await shareManager.start();
              })
            }
          >
            세션 공유 시작
          </button>
        </>
      ) : (
        <>
          <div className={`share-status ${state.status}`}>
            <span className="dot" />
            {STATUS_TEXT[state.status]}
            {state.status === 'online' && ` · 상대 ${state.peers.length}명`}
          </div>
          {state.peers.length > 0 && (
            <ul className="peer-list">
              {state.peers.map((p, i) => (
                <li key={i}>
                  <span className="dot" style={{ background: p.color }} />
                  {p.name}
                </li>
              ))}
            </ul>
          )}
          {state.missingImages > 0 && <p className="hint">층 이미지 {state.missingImages}장을 받는 중…(가진 사람이 접속해 있어야 하오)</p>}

          {link && (
            <div className="link-row">
              <input className="text-input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="세션 링크" />
              <button className="btn small" onClick={copy}>
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
          )}
          {isLocalHost(location.hostname) && (
            <p className="hint">이 컴퓨터 전용 주소(localhost)에서 쓰는 중이라, 링크는 친구가 열 수 있는 공개 사이트 주소로 만들었소. 이 창을 켜 두면 그대로 연결되오.</p>
          )}

          <div className="field">
            세션에 포함할 맵 ({state.included.filter((id) => maps.some((m) => m.id === id)).length}/{maps.length})
            <ul className="include-list">
              {maps.map((m) => {
                const on = state.included.includes(m.id);
                return (
                  <li key={m.id} className={m.id === currentMapId ? 'current' : ''}>
                    <label>
                      <input type="checkbox" checked={on} onChange={(e) => (e.target.checked ? shareManager.include(m.id) : shareManager.exclude(m.id))} />
                      {m.name}
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="hint">체크를 풀면 모두에게서 세션에서 빠지오(각자 이미 받은 사본은 남소).</p>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={state.autoAdd} onChange={(e) => shareManager.setAutoAdd(e.target.checked)} />
            이 기기에서 새로 만든 맵은 자동으로 세션에 넣기
          </label>

          <p className="hint">링크를 가진 사람은 누구나 세션의 맵을 보고 고칠 수 있으니 믿는 사람에게만 보내시오.</p>
          {!confirmLeave ? (
            <button className="btn small ghost danger-text" onClick={() => setConfirmLeave(true)}>
              세션 나가기…
            </button>
          ) : (
            <div className="row-actions">
              <span className="small">나가면 실시간 공유가 끊기오. 이 기기의 맵은 남소.</span>
              <button className="btn small ghost" onClick={() => setConfirmLeave(false)}>
                취소
              </button>
              <button className="btn small danger" disabled={busy} onClick={() => run(() => shareManager.leave()).then(() => setConfirmLeave(false))}>
                나가기
              </button>
            </div>
          )}
        </>
      )}

      <button className="btn small ghost" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
        {advanced ? '▾' : '▸'} 고급: 만남용 릴레이
      </button>
      {advanced && (
        <div className="advanced">
          <p className="hint">
            브라우저끼리 처음 서로를 찾을 때만 쓰는 공개 Nostr 릴레이이오(지도 내용은 여기로 가지 않소). 비워 두면 기본 릴레이 여러 곳을
            쓰오. 바꾸려면 주소(wss://…)를 한 줄에 하나씩 넣되, 양쪽이 같은 릴레이를 하나 이상 써야 하오.
          </p>
          <textarea className="text-input" rows={2} value={relays} placeholder="(기본값 사용)" onChange={(e) => setRelays(e.target.value)} />
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              run(() =>
                shareManager.setRelays(
                  relays
                    .split(/\s+/)
                    .map((s) => s.trim())
                    .filter((s) => /^wss?:\/\//.test(s)),
                ),
              )
            }
          >
            적용
          </button>
        </div>
      )}
    </div>
  );
}
