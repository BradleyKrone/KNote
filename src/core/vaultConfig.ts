// Persistence for the per-vault config (<vault>/.knote/config.json:
// board columns, folders, machines registry, feature toggles). The old
// app-level settings (theme, hotkeys, last vault) are gone — VS Code owns
// all of those natively.

import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_VAULT_CONFIG, type VaultConfig } from '@shared/types'
import { getVaultRoot } from './vaultService'

function vaultConfigPath(): string {
  return join(getVaultRoot(), '.knote', 'config.json')
}

/**
 * Backfill fields added to `BoardColumn` after a vault's config.json was last
 * written — matched by char, since that's the stable key tying a saved
 * column back to its default (name/order can be edited by the user).
 */
function withColumnDefaults(columns: VaultConfig['columns']): VaultConfig['columns'] {
  return columns.map((col) => {
    if (col.requireReason !== undefined) return col
    const fallback = DEFAULT_VAULT_CONFIG.columns.find((d) => d.char === col.char)
    return fallback?.requireReason ? { ...col, requireReason: true } : col
  })
}

export async function getVaultConfig(): Promise<VaultConfig> {
  try {
    const raw = await fs.readFile(vaultConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_VAULT_CONFIG,
      ...parsed,
      columns: withColumnDefaults(
        Array.isArray(parsed.columns) && parsed.columns.length > 0
          ? parsed.columns
          : DEFAULT_VAULT_CONFIG.columns
      )
    }
  } catch {
    return { ...DEFAULT_VAULT_CONFIG }
  }
}

export async function setVaultConfig(config: VaultConfig): Promise<void> {
  await fs.mkdir(join(getVaultRoot(), '.knote'), { recursive: true })
  await fs.writeFile(vaultConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}
