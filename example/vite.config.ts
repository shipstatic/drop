import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Exclude the pre-bundled package from optimization
    exclude: ['@shipstatic/assets'],
  },
});
