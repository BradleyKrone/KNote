import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string
}

export default defineConfig({
  main: {
    // ESM-only packages must be bundled into the CJS main bundle
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          'p-limit',
          'unified',
          'remark-parse',
          'remark-gfm',
          'remark-frontmatter',
          'unist-util-visit'
        ]
      })
    ],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
