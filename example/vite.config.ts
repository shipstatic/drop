import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Exclude the pre-bundled package from optimization
    exclude: ['@shipstatic/drop'],
  },
});
