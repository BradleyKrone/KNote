// Error codes shared across the IPC boundary. Main throws Errors whose
// message starts with one of these codes; the renderer only sees the
// serialized message string, so it matches on the code rather than the type.

/** A whole-file write was refused because the file changed on disk since it was loaded. */
export const CONFLICT_ERROR = 'KNOTE_CONFLICT'

/** A verified line edit was refused because the target line changed or moved on disk. */
export const STALE_ERROR = 'KNOTE_STALE'

export function isConflictError(err: unknown): boolean {
  return String(err).includes(CONFLICT_ERROR)
}

export function isStaleError(err: unknown): boolean {
  return String(err).includes(STALE_ERROR)
}
