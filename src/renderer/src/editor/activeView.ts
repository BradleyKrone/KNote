import type { EditorView } from '@codemirror/view'

/**
 * The most recently focused editor view, if any. Used by the Properties
 * panel (frontmatter edits go through the live buffer, never behind its
 * back), the Kanban board's open-buffer rewrite path, and toolbar commands.
 * With split panes there can be two live editors; this tracks the one that
 * last had focus (which EditorPane keeps aligned with the active pane).
 */
let activeView: EditorView | null = null

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view
}

/** Clear the registration only if `view` is still the active one (pane teardown). */
export function clearActiveEditorView(view: EditorView): void {
  if (activeView === view) activeView = null
}

export function getActiveEditorView(): EditorView | null {
  return activeView
}
