// Opens (or reveals) KNote Home once a day at `knote.home.dailyOpenTime` —
// 4 AM by default — for a VS Code left running overnight. The Home webview
// rolls its own "today" over, so an already-open page only needs revealing.

import * as vscode from 'vscode'
import { crossedDailyTime, parseDailyTime } from '@shared/dailySchedule'
import { currentVaultRoot } from './engine'

const CHECK_INTERVAL_MS = 60_000

export function registerHomeSchedule(context: vscode.ExtensionContext): void {
  let lastCheck = new Date()
  const timer = setInterval(() => {
    const now = new Date()
    const time = parseDailyTime(
      vscode.workspace.getConfiguration('knote').get<string>('home.dailyOpenTime', '04:00')
    )
    if (time && currentVaultRoot() && crossedDailyTime(lastCheck, now, time)) {
      void vscode.commands.executeCommand('knote.openHome')
    }
    lastCheck = now
  }, CHECK_INTERVAL_MS)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
}
