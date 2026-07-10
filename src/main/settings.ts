// Persistence for app-level settings (knote-settings.json in userData:
// last vault, theme) and the per-vault config (.knote/config.json:
// board columns, folders, feature toggles).

import { app, nativeTheme } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import {
  DEFAULT_VAULT_CONFIG,
  type AppSettings,
  type ThemeName,
  type VaultConfig
} from '@shared/types'
import { getVaultRoot } from './vaultService'

const DEFAULTS: AppSettings = {
  lastVault: null,
  theme: 'dark',
  readableLineLength: true,
  hotkeyOverrides: {}
}

let cached: AppSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'knote-settings.json')
}

export async function getSettings(): Promise<AppSettings> {
  if (cached) return cached
  let loaded: AppSettings
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8')
    loaded = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    loaded = { ...DEFAULTS }
  }
  cached = loaded
  return loaded
}

async function save(): Promise<void> {
  if (!cached) return
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(cached, null, 2), 'utf-8')
}

export async function setLastVault(root: string | null): Promise<void> {
  const s = await getSettings()
  s.lastVault = root
  await save()
}

export async function setTheme(theme: ThemeName): Promise<void> {
  const s = await getSettings()
  s.theme = theme
  await save()
  nativeTheme.themeSource = theme
}

export async function setReadableLineLength(enabled: boolean): Promise<void> {
  const s = await getSettings()
  s.readableLineLength = enabled
  await save()
}

export async function setHotkeyOverrides(overrides: Record<string, string | null>): Promise<void> {
  const s = await getSettings()
  s.hotkeyOverrides = overrides
  await save()
}

// ---------- Per-vault config (<vault>/.knote/config.json) ----------

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
