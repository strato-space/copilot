import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from "vite-plugin-svgr";

function stripBluebirdUnreachableEval() {
  return {
    name: 'strip-bluebird-unreachable-eval',
    enforce: 'pre',
    transform(code, id) {
      // Bluebird includes `eval(obj);` after a `return obj;` in toFastProperties(),
      // which triggers Firefox "unreachable code after return statement" warnings.
      if (!id.includes('node_modules/bluebird/js/release/util.js')) return;
      return code.replace(/\n\s*eval\(obj\);\s*\n/, '\n');
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true,
    allowedHosts: ["voice-dev.stratospace.fun", "voice.stratospace.fun"],
  },
  optimizeDeps: {
    // Vite pre-bundles deps into node_modules/.vite/deps. Firefox warns when it
    // sees empty sourcemaps like `{ sources: [] }`, so disable sourcemaps for
    // optimized deps to keep the console clean.
    esbuildOptions: {
      sourcemap: false,
    },
  },
  plugins: [stripBluebirdUnreachableEval(), svgr(), react()],
})
