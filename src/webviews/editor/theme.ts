// CodeMirror theme mapped onto VS Code's --vscode-* theme variables so the
// editor follows the active color theme (mirrors shared/webview.css).

import { EditorView } from '@codemirror/view'

export const knoteTheme = EditorView.theme({
  '&': {
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    height: '100%'
  },
  '.cm-scroller': {
    fontFamily: 'var(--vscode-editor-font-family, ui-monospace, monospace)',
    fontSize: 'var(--vscode-editor-font-size, 14px)',
    lineHeight: '1.5'
  },
  '.cm-content': {
    caretColor: 'var(--vscode-editorCursor-foreground)'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--vscode-editorCursor-foreground)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--vscode-editor-selectionBackground)'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--vscode-editorGutter-background, var(--vscode-editor-background))',
    color: 'var(--vscode-editorLineNumber-foreground)',
    border: 'none'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)',
    color: 'var(--vscode-editorLineNumber-activeForeground)'
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)'
  }
})
