import { app, BrowserWindow, dialog, nativeTheme, net, protocol, session } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { IpcChannels } from '@shared/ipc'
import type { ThemeName } from '@shared/types'
import { registerIpcHandlers } from './ipcHandlers'
import { getSettings } from './settings'
import * as vault from './vaultService'
import { isImage } from '@shared/pathUtils'
import { stopWatching } from './watcher'

// Serves images from inside the open vault to the renderer as knote://img/<rel-path>
protocol.registerSchemesAsPrivileged([
  { scheme: 'knote', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

// Dev-only: allow driving the app over CDP for automated verification
if (!app.isPackaged && process.env['KNOTE_DEBUG_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['KNOTE_DEBUG_PORT'])
}
// Dev-only: isolated settings/profile so test instances don't share state
if (!app.isPackaged && process.env['KNOTE_USER_DATA']) {
  app.setPath('userData', process.env['KNOTE_USER_DATA'])
}

let mainWindow: BrowserWindow | null = null

function createWindow(theme: ThemeName): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: theme === 'light' ? '#ffffff' : '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Show the app version in the OS title bar next to the app name. The
  // loaded page's <title>KNote</title> would otherwise reassert itself
  // over our version-qualified title, so we lock it down here.
  mainWindow.setTitle(`KNote ${app.getVersion()}`)
  mainWindow.on('page-title-updated', (e) => e.preventDefault())

  // KNote never navigates away from its own UI and never opens child windows.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // The renderer-side webFrame spellcheck APIs don't work with the native
  // Windows checker, so the misspelled word + suggestions are only available
  // here, on Chromium's context-menu event. Forward them to the editor, which
  // renders its own styled menu. Gated on isEditable — the CodeMirror content
  // is the only editable surface, so this never fires for the file tree etc.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    mainWindow?.webContents.send(IpcChannels.evSpellContextMenu, {
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions
    })
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Hard zero-network guarantee: block every request that isn't local.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const local =
      url.startsWith('file:') ||
      url.startsWith('knote:') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('devtools:') ||
      url.startsWith('chrome-extension:') ||
      (devUrl !== undefined &&
        (url.startsWith(devUrl) || url.startsWith(devUrl.replace(/^http/, 'ws'))))
    callback({ cancel: !local })
  })

  // Spell checking uses the OS-native checker on Windows/macOS (no dictionary
  // download, so the zero-network policy above is untouched). Enable it and set
  // the language explicitly; suggestions surface via the context-menu event.
  session.defaultSession.setSpellCheckerEnabled(true)
  session.defaultSession.setSpellCheckerLanguages(['en-US'])

  protocol.handle('knote', async (request) => {
    const prefix = 'knote://img/'
    if (!request.url.startsWith(prefix)) return new Response('Not found', { status: 404 })
    try {
      const rel = decodeURIComponent(request.url.slice(prefix.length))
      if (!isImage(rel)) return new Response('Forbidden', { status: 403 })
      const abs = vault.toAbs(rel)
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  registerIpcHandlers(() => {
    if (!mainWindow) throw new Error('No window')
    return mainWindow
  })

  const settings = await getSettings() // warm the settings cache
  nativeTheme.themeSource = settings.theme
  createWindow(settings.theme)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.theme)
  })
}).catch((err) => {
  console.error('Failed to start KNote:', err)
  dialog.showErrorBox('KNote failed to start', err instanceof Error ? err.message : String(err))
  app.quit()
})

app.on('window-all-closed', () => {
  void stopWatching()
  if (process.platform !== 'darwin') app.quit()
})

// Never allow opening external protocols from within the app
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
})
