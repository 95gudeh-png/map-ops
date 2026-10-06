import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 등 하위 경로 배포를 위해 상대 경로로 빌드
  base: './',
});
