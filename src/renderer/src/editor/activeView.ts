import type { EditorView } from '@codemirror/view'

/**
 * The currently mounted editor view, if any. Used by the Properties panel
 * (frontmatter edits go through the live buffer, never behind its back) and,
 * later, by the Kanban board's open-buffer rewrite path.
 */
let activeView: EditorView | null = null

export function setActiveEditorView(view: EditorView | null): void {
  activeView = view
}

export function getActiveEditorView(): EditorView | null {
  return activeView
}
