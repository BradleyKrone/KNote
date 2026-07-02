import { app, BrowserWindow, net, protocol, session } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // KNote never navigates away from its own UI and never opens child windows.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

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

  await getSettings() // warm the settings cache
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void stopWatching()
  if (process.platform !== 'darwin') app.quit()
})

// Never allow opening external protocols from within the app
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
})
