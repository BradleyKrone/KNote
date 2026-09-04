// Config for the KNote VS Code integration harness (`npm run test:integration`).
//
// @vscode/test-cli downloads a real VS Code, launches it with this extension
// loaded (Extension Development Host), and runs the compiled Mocha tests in
// ../out/test against a disposable copy of the fixture vault. Unit tests
// (vitest, `tests/`) stay separate — this only covers behavior that needs the
// live `vscode` API.

import { defineConfig } from '@vscode/test-cli'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'fs'
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

// A second, unrelated folder for the multi-folder tests. It lives nowhere near
// the vault on purpose — the whole point of mounts is spanning folders that
// share no path — and is opened through a generated .code-workspace file,
// which is the only way to get the harness into a real multi-root host.
// Not a dotted name: a mount is named after its folder, and KNote refuses to
// mount anything whose name starts with a dot (it would be ignored anyway).
const mount = resolve(here, 'test/tmp-mount')
rmSync(mount, { recursive: true, force: true })
mkdirSync(resolve(mount, 'docs'), { recursive: true })
writeFileSync(
  resolve(mount, 'docs/Mounted Note.md'),
  `# Mounted Note

- [ ] a task in the mounted folder
`
)

const mountedWorkspace = resolve(here, 'test/.tmp-mounted.code-workspace')
writeFileSync(
  mountedWorkspace,
  JSON.stringify({ folders: [{ path: workspace }, { path: mount }], settings: {} }, null, 2)
)

const mocha = { ui: 'bdd', color: true, timeout: 60000 }

// Disable OTHER installed extensions for a clean, deterministic host; the
// KNote extension under test is still loaded via --extensionDevelopmentPath.
const launchArgs = ['--disable-extensions']

export default defineConfig([
  {
    label: 'integration',
    files: 'out/test/integration/**/*.test.js',
    workspaceFolder: workspace,
    launchArgs,
    mocha
  },
  {
    label: 'integration-mounts',
    files: 'out/test/mounts/**/*.test.js',
    workspaceFolder: mountedWorkspace,
    launchArgs,
    mocha
  }
])
