import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@client': resolve('./src/client'),
      '@server': resolve('./src/server'),
      '@shared': resolve('./src/shared')
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve('./index.html')
      }
    }
  },
  server: {
    port: 3000
  }
});