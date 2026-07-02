import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_VAULT_CONFIG, type AppSettings, type ThemeName, type VaultConfig } from '@shared/types'
import { getVaultRoot } from './vaultService'

const DEFAULTS: AppSettings = {
  lastVault: null,
  theme: 'dark'
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
}

// ---------- Per-vault config (<vault>/.knote/config.json) ----------

function vaultConfigPath(): string {
  return join(getVaultRoot(), '.knote', 'config.json')
}

export async function getVaultConfig(): Promise<VaultConfig> {
  try {
    const raw = await fs.readFile(vaultConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_VAULT_CONFIG,
      ...parsed,
      columns:
        Array.isArray(parsed.columns) && parsed.columns.length > 0
          ? parsed.columns
          : DEFAULT_VAULT_CONFIG.columns
    }
  } catch {
    return { ...DEFAULT_VAULT_CONFIG }
  }
}

export async function setVaultConfig(config: VaultConfig): Promise<void> {
  await fs.mkdir(join(getVaultRoot(), '.knote'), { recursive: true })
  await fs.writeFile(vaultConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}
