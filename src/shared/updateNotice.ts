/**
 * Whether activation should tell the user KNote updated. `undefined` for
 * `previousVersion` means this is the first activation ever (nothing stored
 * in globalState yet) — a fresh install has nothing to compare against, so it
 * stays silent rather than announcing an "update" to version zero.
 */
export function shouldShowUpdateNotice(
  previousVersion: string | undefined,
  currentVersion: string
): boolean {
  return previousVersion !== undefined && previousVersion !== currentVersion
}
