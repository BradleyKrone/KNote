// Shared by both paste-image entry points (extension/providers/pasteImage.ts
// for the native text editor, webviews/editor/pasteImage.ts for the
// CodeMirror live-preview editor): land a pasted image's wiki-embed on its
// own line, since inserting it mid-line would glue it onto that line's text
// and break the line's markdown parsing (e.g. right before a `#` heading).

/**
 * Wrap `embed` with newlines as needed so it ends up alone on its own line,
 * given the text of the line the cursor is on and the cursor's character
 * offset within that line.
 */
export function wrapEmbedForInsertion(lineText: string, posInLine: number, embed: string): string {
  const hasTextBefore = posInLine > 0
  const hasTextAfter = posInLine < lineText.length
  return `${hasTextBefore ? '\n' : ''}${embed}${hasTextAfter ? '\n' : ''}`
}
