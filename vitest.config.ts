import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      // Extension host (only its vscode-free selectors are importable here)
      '@ext': resolve(__dirname, 'src/extension'),
      // Webview React apps (pure selectors/models are tested from here)
      '@': resolve(__dirname, 'src/webviews')
    }
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
})
