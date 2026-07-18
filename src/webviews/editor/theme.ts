// CodeMirror theme mapped onto VS Code's --vscode-* theme variables so the
// editor follows the active color theme (mirrors shared/webview.css).

import { EditorView } from '@codemirror/view'

export const knoteTheme = EditorView.theme({
  '&': {
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    height: '100%'
  },
  // Rendered body text reads as a document: proportional UI font, comfortable
  // line spacing. Code/tables opt back into monospace via their own classes.
  '.cm-scroller': {
    fontFamily: "var(--vscode-font-family, -apple-system, 'Segoe UI', system-ui, sans-serif)",
    fontSize: '15px',
    lineHeight: '1.7'
  },
  // Fill the full editor width with page padding.
  '.cm-content': {
    caretColor: 'var(--vscode-editorCursor-foreground)',
    padding: '2.2rem 3rem 40vh'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--vscode-editorCursor-foreground)'
  },
  // Text selection. drawSelection() paints the highlight as its own layer
  // *behind* the text, so we colour that layer (not the native browser
  // ::selection, which would double-paint into a pale, washed-out wash). Many
  // themes ship a very faint editor.selectionBackground, so we use an explicit
  // solid blue that reads well against white text, and force selected glyphs
  // to white via ::selection so dimmed live-preview text (completed tasks,
  // meta lines) stays readable while highlighted.
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: '#2f5fb3 !important'
  },
  '.cm-content ::selection, .cm-line ::selection': {
    backgroundColor: 'transparent !important',
    color: '#ffffff !important'
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
  },
  // Autocomplete popup (#tags and [[wiki links]]), mapped onto VS Code's
  // suggestion-widget theme colors so it matches the native editor.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    border: '1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent))',
    borderRadius: '4px',
    backgroundColor:
      'var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background))',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: "var(--vscode-font-family, -apple-system, 'Segoe UI', system-ui, sans-serif)",
    fontSize: '13px',
    maxHeight: '16em'
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '2px 8px',
    color: 'var(--vscode-editorSuggestWidget-foreground, var(--vscode-editor-foreground))'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor:
      'var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground))',
    color:
      'var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground))'
  },
  '.cm-completionMatchedText': {
    color:
      'var(--vscode-editorSuggestWidget-highlightForeground, var(--vscode-list-highlightForeground))',
    textDecoration: 'none',
    fontWeight: 'bold'
  },
  '.cm-completionDetail': {
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'normal',
    marginLeft: '0.75em'
  },
  // Misspelled words: a red wavy underline, matching VS Code's own squiggles
  // (see spellcheck/spellCheck.ts). Uses text-decoration so it follows the word
  // across line wraps without disturbing layout.
  '.cm-spell-error': {
    textDecoration: 'underline wavy var(--vscode-editorError-foreground, #e51400)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '0.2em'
  }
})
