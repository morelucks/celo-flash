import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@privy-io')) {
              return 'privy';
            }
            if (id.includes('ethers')) {
              return 'ethers';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react-core';
            }
            return 'vendor';
          }
        },
      },
    },
  },
})
