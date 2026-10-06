import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 등 하위 경로 배포를 위해 상대 경로로 빌드
  base: './',
  // 데이터(IndexedDB)는 주소별로 저장되므로 포트가 바뀌면 맵이 안 보인다 → 고정
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
