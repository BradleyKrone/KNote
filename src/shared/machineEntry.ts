// Shape of a 🚜 machine work-log entry, shared by the native-editor insert
// command (src/extension/commands/machineEntry.ts) and the live-preview
// editor's right-click "Log machine work…" action (src/webviews/editor).
// Pure data + string building, no vscode/CodeMirror imports.

/** Detail lines auto-added below every new machine work-log entry. */
const MACHINE_ENTRY_TEMPLATE_LABELS = ['Base Machine Software', 'Testing Software', 'Notes']

/** The blank detail template appended under a new machine entry (leading newline per label). */
export function machineEntryTemplate(): string {
  return MACHINE_ENTRY_TEMPLATE_LABELS.map((label) => `\n- ${label}: `).join('')
}
