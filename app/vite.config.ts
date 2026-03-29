import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const sourcemap = env.VITE_BUILD_SOURCEMAP === 'true';
  const minify = env.VITE_BUILD_MINIFY === 'false' ? false : 'esbuild';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        react: path.resolve(process.cwd(), 'node_modules/react'),
        'react-dom': path.resolve(process.cwd(), 'node_modules/react-dom'),
        'react/jsx-runtime': path.resolve(process.cwd(), 'node_modules/react/jsx-runtime.js'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3002',
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap,
      minify,
    },
  };
});
