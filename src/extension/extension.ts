import * as vscode from 'vscode'
import { findVaultRoot, initializeVault, maybeSuggestInitialize } from './vault'
import { startEngine, stopEngine } from './engine'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('KNote')
  context.subscriptions.push(log)

  const start = async (root: string): Promise<void> => {
    try {
      await startEngine(root, log)
    } catch (err) {
      log.appendLine(`Failed to start: ${err instanceof Error ? err.message : String(err)}`)
      void vscode.window.showErrorMessage('KNote failed to open the vault — see the KNote output channel.')
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('knote.initializeVault', async () => {
      const root = await initializeVault()
      if (!root) return
      await start(root)
      void vscode.window.showInformationMessage('KNote vault initialized.')
    })
  )

  const root = await findVaultRoot()
  if (root) {
    await start(root)
  } else {
    void maybeSuggestInitialize(context, async () => {
      const initialized = await initializeVault()
      if (initialized) await start(initialized)
    })
  }
}

export async function deactivate(): Promise<void> {
  await stopEngine()
}
