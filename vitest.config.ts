import { defineConfig, type Plugin } from 'vitest/config'
import { resolve } from 'path'

// esbuild (the real build) loads typo-js's .aff/.dic dictionary files as
// plain text via its `loader` config (see spellcheck/typo.d.ts). Vite/vitest
// don't know that convention and fail to parse them as JS — stub them as
// empty text so any test importing the editor's full extension stack
// (setupEditor.ts, which pulls in spellCheck) can do so without a real
// dictionary; nothing here exercises spell-checking itself.
const stubDictionaryFiles: Plugin = {
  name: 'stub-dictionary-files',
  transform(_code, id) {
    if (id.endsWith('.aff') || id.endsWith('.dic')) return 'export default ""'
  }
}

export default defineConfig({
  plugins: [stubDictionaryFiles],
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
    include: ['tests/**/*.test.ts'],
    // Stubs the webview's acquireVsCodeApi so editor modules that reach the RPC
    // client are importable under Node — see tests/setup.ts.
    setupFiles: ['tests/setup.ts']
  }
})
