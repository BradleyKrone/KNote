// Deciding which extra folders join the vault, and under what name.
//
// A KNote vault is one folder — the *primary* root, the one holding `.knote/`.
// Any other folder the user has open (a second workspace folder, living
// somewhere else on disk entirely) is *mounted*: it appears as a virtual
// top-level folder of the vault, named after itself, so
// `C:\Git\teamargos.org\docs\x.md` is just the VaultPath `teamargos.org/docs/x.md`.
//
// That prefix is what keeps the rest of KNote unchanged — every layer above
// vaultService still sees an ordinary VaultPath string, and two roots holding
// `Projects/Notes.md` can't collide in the index.
//
// The prefix is also written into notes (`[[teamargos.org/docs/x]]`), which is
// why a name is never silently adjusted: a mount that renamed itself between
// sessions would dangle every link carrying the old name. Every rule below
// therefore *rejects* with a reason instead of auto-suffixing, and the user
// resolves it explicitly via `mountNames` in `.knote/config.json`.
//
// Pure and vscode-free: the host supplies the candidate paths, this decides.

import { resolve, sep, basename } from 'path'

export interface VaultMount {
  /** Vault-relative folder name this root is mounted under (no separators). */
  readonly name: string
  /** Absolute path of the mounted folder. */
  readonly root: string
}

export interface RejectedMount {
  readonly path: string
  readonly reason: string
}

export interface MountPlan {
  readonly mounts: VaultMount[]
  readonly rejected: RejectedMount[]
}

export interface PlanMountsOptions {
  /** Absolute paths the user has opted out of (VaultConfig.excludedFolders). */
  readonly excluded?: readonly string[]
  /** Absolute path → explicit mount name (VaultConfig.mountNames). */
  readonly names?: Readonly<Record<string, string>>
}

/**
 * Names a mount can never take: they'd be invisible or ambiguous. `isIgnoredRel`
 * drops these segments outright, so a folder mounted under one of them would be
 * indexed as nothing at all.
 */
const RESERVED_NAMES = new Set(['.knote', '.git', '.obsidian', 'node_modules'])

/** Windows paths are case-insensitive; comparing roots has to be too. */
function sameRoot(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** True when `inner` is `outer` itself or sits underneath it. */
function isUnder(inner: string, outer: string): boolean {
  const i = inner.toLowerCase()
  const o = outer.toLowerCase()
  return i === o || i.startsWith(o.endsWith(sep) ? o : o + sep)
}

function invalidNameReason(name: string): string | null {
  if (name === '') return 'the folder has no usable name'
  if (name.includes('/') || name.includes(sep)) return `"${name}" contains a path separator`
  if (name.startsWith('.')) return `"${name}" starts with a dot, so KNote would ignore it`
  if (RESERVED_NAMES.has(name.toLowerCase())) return `"${name}" is a reserved folder name`
  return null
}

/**
 * Work out which candidate folders can be mounted, in workspace order.
 *
 * `primaryTopLevelNames` is one `readdir` of the primary root — a mount may not
 * shadow a folder that really exists there, or `toAbs` would route past it and
 * make the real folder unreachable.
 */
export function planMounts(
  primaryRoot: string,
  candidatePaths: readonly string[],
  primaryTopLevelNames: readonly string[],
  opts: PlanMountsOptions = {}
): MountPlan {
  const primary = resolve(primaryRoot)
  const excluded = new Set((opts.excluded ?? []).map((p) => resolve(p).toLowerCase()))
  const names = opts.names ?? {}
  const takenNames = new Set(primaryTopLevelNames.map((n) => n.toLowerCase()))

  const mounts: VaultMount[] = []
  const rejected: RejectedMount[] = []
  const reject = (path: string, reason: string): void => {
    rejected.push({ path, reason })
  }

  for (const candidate of candidatePaths) {
    const root = resolve(candidate)

    if (sameRoot(root, primary)) continue // the vault itself, not a mount
    if (excluded.has(root.toLowerCase())) {
      reject(root, 'excluded in KNote settings')
      continue
    }

    // Nesting would give one file two VaultPaths and index it twice.
    if (isUnder(root, primary)) {
      reject(root, 'already inside the vault')
      continue
    }
    if (isUnder(primary, root)) {
      reject(root, 'contains the vault folder')
      continue
    }
    const overlapping = mounts.find((m) => isUnder(root, m.root) || isUnder(m.root, root))
    if (overlapping) {
      reject(root, `overlaps the folder already mounted as "${overlapping.name}"`)
      continue
    }

    const explicit = Object.entries(names).find(([p]) => sameRoot(resolve(p), root))?.[1]
    const name = (explicit ?? basename(root)).trim()

    const bad = invalidNameReason(name)
    if (bad) {
      reject(root, `${bad} — set a name for it in KNote settings`)
      continue
    }
    if (takenNames.has(name.toLowerCase())) {
      reject(
        root,
        `"${name}" is already taken in the vault — set a different name in KNote settings`
      )
      continue
    }

    takenNames.add(name.toLowerCase())
    mounts.push({ name, root })
  }

  return { mounts, rejected }
}
