// Browser-build stub for Node's `fs`, aliased in for the editor webview bundle
// (see esbuild.mjs). typo-js references `fs` only on its auto-load code path,
// which KNote never triggers — we always construct Typo with the dictionary
// data preloaded — so these are dead stubs kept only to satisfy the bundler.
module.exports = {
  existsSync: () => false,
  readFileSync: () => ''
}
