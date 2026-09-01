import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Vite config for the Mind the Lines client.
// - React plugin for JSX/Fast Refresh.
// - Dev server on 5173, host true so it is reachable inside Docker.
// - fs.allow whitelists the sibling ../shared/src so `import '../../shared/src/types'`
//   resolves during dev without Vite blocking access outside the project root.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../shared', import.meta.url)),
      ],
    },
  },
});
