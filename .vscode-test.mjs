// Config for the KNote VS Code integration harness (`npm run test:integration`).
//
// @vscode/test-cli downloads a real VS Code, launches it with this extension
// loaded (Extension Development Host), and runs the compiled Mocha tests in
// ../out/test against a disposable copy of the fixture vault. Unit tests
// (vitest, `tests/`) stay separate — this only covers behavior that needs the
// live `vscode` API.

import { defineConfig } from '@vscode/test-cli'
import { cpSync, mkdirSync, rmSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = resolve(here, 'test/fixtures/vault')
const workspace = resolve(here, 'test/.tmp-vault')

// A fresh, disposable vault every run so tests can freely mutate note files
// without dirtying the committed fixture. (test/.tmp-vault is gitignored.)
rmSync(workspace, { recursive: true, force: true })
mkdirSync(workspace, { recursive: true })
cpSync(fixture, workspace, { recursive: true })

export default defineConfig({
  label: 'integration',
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder: workspace,
  // Disable OTHER installed extensions for a clean, deterministic host; the
  // KNote extension under test is still loaded via --extensionDevelopmentPath.
  launchArgs: ['--disable-extensions'],
  mocha: {
    ui: 'bdd',
    color: true,
    timeout: 60000
  }
})
