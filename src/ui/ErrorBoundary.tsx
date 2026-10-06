import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** 화면 일부의 오류로 앱 전체가 하얗게 되지 않도록 잡아서 안내한다. 데이터는 이미 저장되어 있으므로 새로고침으로 복구된다. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[MAP OPS] 화면 오류', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice error error-screen" role="alert">
        <div>
          <b>화면을 그리다 오류가 났소.</b> 저장된 맵은 안전하오. 새로고침하면 대부분 복구되오.
          <div className="dim small">{this.state.error.message}</div>
        </div>
        <button className="btn small" onClick={() => location.reload()}>
          새로고침
        </button>
      </div>
    );
  }
}
