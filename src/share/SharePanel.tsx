import { useState } from 'react';
import type { Id } from '../model';
import { getRelays, isLocalHost, shareManager, useShareState } from './shareManager';

interface Props {
  mapId: Id;
  onClose: () => void;
}

const STATUS_TEXT = {
  local: '로컬',
  connecting: '릴레이에 연결 중…',
  online: '공유 중',
  offline: '연결 끊김(로컬 변경은 보존됨)',
} as const;

export function SharePanel({ mapId, onClose }: Props) {
  const state = useShareState(mapId);
  const [user, setUser] = useState(shareManager.getUser());
  const [copied, setCopied] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [relays, setRelays] = useState(getRelays().join('\n'));
  const link = shareManager.link(mapId);

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

  return (
    <div className="popover share-pop" role="dialog" aria-label="공유" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="form-title">실시간 공유</div>

      <label className="field">
        내 이름
        <span className="name-row">
          <input type="color" value={user.color} onChange={(e) => setUser({ ...user, color: e.target.value })} onBlur={saveUser} aria-label="내 색" />
          <input className="text-input" type="text" value={user.name} maxLength={20} onChange={(e) => setUser({ ...user, name: e.target.value })} onBlur={saveUser} />
        </span>
      </label>

      {!state.shared ? (
        <>
          <p className="hint">
            공유를 시작하면 링크가 만들어지오. 링크를 받은 친구가 열면 이 맵(층 이미지·정렬·마커)이 실시간으로 함께 바뀌오. 서버 없이
            브라우저끼리 직접(P2P) 연결되므로 <b>양쪽이 동시에 접속해 있어야</b> 주고받을 수 있소.
          </p>
          <button
            className="btn primary"
            onClick={() => {
              saveUser();
              shareManager.start(mapId);
            }}
          >
            공유 시작
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
              <input className="text-input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="공유 링크" />
              <button className="btn small" onClick={copy}>
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
          )}
          {isLocalHost(location.hostname) && (
            <p className="hint">
              지금은 이 컴퓨터 전용 주소(localhost)에서 쓰는 중이라, 링크는 친구가 열 수 있는 공개 사이트 주소로 만들었소. 친구가 링크를 열면
              이 화면과 그대로 연결되오(이 창을 켜 두시오).
            </p>
          )}
          <p className="hint">링크를 가진 사람은 누구나 이 맵을 보고 고칠 수 있으니 믿는 사람에게만 보내시오.</p>
          <button className="btn small ghost danger-text" onClick={() => shareManager.stop(mapId)}>
            공유 중지 (이 기기의 맵은 남음)
          </button>
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
            onClick={() =>
              shareManager.setRelays(
                relays
                  .split(/\s+/)
                  .map((s) => s.trim())
                  .filter((s) => /^wss?:\/\//.test(s)),
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
