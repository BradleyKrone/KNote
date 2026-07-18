# Integration test harness

These tests run KNote inside a **real VS Code** (an Extension Development Host),
so they exercise the parts unit tests can't reach: activation, command
registration, verified edits against live `TextEditor` buffers, and disk
persistence. They are the automated replacement for "F5 and check by hand."

- **Unit tests** (`tests/`, plural) — vitest, pure `core`/`shared`/webview
  selectors, no `vscode`. Fast; run constantly.
- **Integration tests** (`test/`, singular) — this harness, `@vscode/test-cli`
  + Mocha, real `vscode` API. Slower; downloads a VS Code build on first run.

## Run

```bash
npm run test:integration
```

That script builds the extension, compiles the tests, then launches VS Code.
The first run downloads a VS Code build into `.vscode-test/` (gitignored); it is
cached after that. Requires network **once** for that download — the extension
itself stays fully offline.

## How it works

- `.vscode-test.mjs` — harness config. Before each run it wipes `test/.tmp-vault`
  and re-seeds it from `test/fixtures/vault`, so every run gets a clean vault the
  tests can mutate. Points VS Code at that folder as the workspace.
- `test/fixtures/vault/` — the committed seed vault (`.knote/config.json` + a
  `Sample.md`). Edit this to give tests more to work with.
- `test/integration/*.test.ts` — the tests. Black-box: they import only `vscode`
  and Node built-ins (see `helpers.ts`), never app source, so the harness stays
  independent of how the extension is bundled.
- `test/tsconfig.json` — compiles the tests to `out/test/` as CommonJS for Mocha.

## Add a test

1. Drop a `*.test.ts` in `test/integration/`.
2. Use `helpers.ts` to activate, open notes, read disk, and `waitFor` async
   settling (editor edits, saves, and the watcher all land a beat after a
   command returns — poll, don't sleep a fixed amount).
3. Drive behavior through `vscode.commands.executeCommand('knote.…')` and assert
   on the buffer and/or `readNoteOnDisk(...)`.

## Debugging

Run `npm run test:integration` with a breakpoint via the "Extension Tests"
launch config, or add `console.log` — Mocha output streams to the terminal.
