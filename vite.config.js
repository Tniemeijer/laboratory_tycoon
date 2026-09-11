import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: process.env.GITHUB_PAGES ? '/laboratory_tycoon/' : '/',
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