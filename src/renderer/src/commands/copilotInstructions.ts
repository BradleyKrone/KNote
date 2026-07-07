import copilotDoc from '../../../../resources/copilot-instructions.md?raw'
import { useVaultStore } from '@/stores/vaultStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

/**
 * Place the bundled "GitHub Copilot instructions" doc into the vault's Knote
 * Resources folder (if it isn't already there) and open it, so the user can
 * read it and copy it out into their own `.github/copilot-instructions.md`.
 */
export async function openCopilotInstructions(): Promise<void> {
  const path = await window.knote.ensureCopilotDoc(copilotDoc)
  await useVaultStore.getState().refreshTree()
  await useWorkspaceStore.getState().openFile(path)
}
