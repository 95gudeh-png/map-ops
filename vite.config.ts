import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 등 하위 경로 배포를 위해 상대 경로로 빌드
  base: './',
  server: {
    // 데이터(IndexedDB)는 주소별로 저장되므로 포트가 바뀌면 맵이 안 보인다 → 고정
    port: 5173,
    strictPort: true,
    // 이 폴더(한글 경로, Windows)에서는 파일 변경 알림이 가끔 누락되어 낡은 코드가 서빙됐다 → 주기적 확인
    watch: { usePolling: true, interval: 300 },
  },
  preview: { port: 5173, strictPort: true },
});
