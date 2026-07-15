// Builds the extension host bundle and one browser bundle per webview.
// Everything is bundled locally (no CDN, no runtime downloads) — KNote is
// fully offline by design.

import esbuild from 'esbuild'
import { existsSync, readdirSync } from 'fs'
import { resolve } from 'path'

const watch = process.argv.includes('--watch')

const alias = {
  '@shared': resolve('src/shared'),
  '@core': resolve('src/core')
}

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  alias,
  logLevel: 'info'
}

function webviewEntryPoints() {
  if (!existsSync('src/webviews')) return []
  return readdirSync('src/webviews', { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`src/webviews/${d.name}/main.tsx`))
    .map((d) => `src/webviews/${d.name}/main.tsx`)
}

/** @type {import('esbuild').BuildOptions | null} */
const webviewOptions = (() => {
  const entryPoints = webviewEntryPoints()
  if (entryPoints.length === 0) return null
  return {
    entryPoints,
    outdir: 'dist/webviews',
    entryNames: '[dir]', // src/webviews/board/main.tsx -> dist/webviews/board.js
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    alias,
    logLevel: 'info'
  }
})()

const builds = [hostOptions, ...(webviewOptions ? [webviewOptions] : [])]

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)))
}
