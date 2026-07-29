// Regression cover for the Live Preview sync corrupting CRLF notes.
//
// CodeMirror's Text counts a line break as ONE character; VS Code's
// TextDocument.positionAt counts `\r\n` as TWO. The editor used to ship raw
// CodeMirror offsets to the host, which fed them straight to positionAt, so
// every edit landed one character too early per preceding line — scattering
// dropped characters through the saved file while the CodeMirror view still
// looked correct. Positions now cross the boundary as line/character, which
// both sides agree on whatever the EOL.
//
// These run @codemirror/state headless (no EditorView, so no DOM), which lets a
// single test drive the real round trip: CodeMirror transaction → CmEdit →
// applyCmEdits → host text.

import { describe, expect, it } from 'vitest'
import { EditorState, type Text } from '@codemirror/state'
import { applyCmEdits, type CmEdit, type CmPos } from '@shared/editorSync'

const CRLF = '\r\n'

const INTENDED = ['## Propose 2D Features', '- Blade Monitor', '- Stable Bucket', '- Steer Assist']

/** Mirrors posAt() in src/webviews/editor/setupEditor.ts. */
function posAt(doc: Text, offset: number): CmPos {
  const line = doc.lineAt(offset)
  return { line: line.number - 1, ch: offset - line.from }
}

/** The CmEdits the editor's outbound sync would post for a change. */
function editsFor(state: EditorState, changes: { from: number; to?: number; insert?: string }) {
  const tr = state.update({ changes })
  const edits: CmEdit[] = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({
      from: posAt(tr.startState.doc, fromA),
      to: posAt(tr.startState.doc, toA),
      insert: inserted.toString()
    })
  })
  return { edits, next: tr.state }
}

/** The host text CodeMirror now believes in, in the note's own EOL. */
function cmTextAs(state: EditorState, eol: string): string {
  return state.doc.toString().replace(/\n/g, eol)
}

describe('CodeMirror document invariants the sync depends on', () => {
  it('normalizes CRLF away, so CM offsets are LF-string offsets', () => {
    const crlf = INTENDED.join(CRLF)
    const state = EditorState.create({ doc: crlf })

    expect(state.doc.lines).toBe(4)
    // 3 line breaks counted as 1 char each, not 2.
    expect(state.doc.length).toBe(crlf.length - 3)
    expect(state.doc.length).toBe(INTENDED.join('\n').length)
    expect(state.lineBreak).toBe('\n')
    // toString() (what the inbound diff compares) matches sliceDoc(); with a
    // CRLF lineSeparator facet set they diverge and the diff mangles the doc.
    expect(state.doc.toString()).toBe(state.sliceDoc())
    expect(state.sliceDoc()).not.toContain('\r')
  })

  it('agrees with VS Code on line/character even though offsets differ', () => {
    const crlf = INTENDED.join(CRLF)
    const state = EditorState.create({ doc: crlf })
    const vsLines = crlf.split(CRLF)

    for (let line = 0; line < vsLines.length; line++) {
      for (let ch = 0; ch < vsLines[line].length; ch++) {
        const offset = state.doc.line(line + 1).from + ch
        expect(posAt(state.doc, offset)).toEqual({ line, ch })
        // Same coordinate, same character, in both models.
        expect(state.sliceDoc(offset, offset + 1)).toBe(vsLines[line][ch])
      }
    }
  })
})

describe('applyCmEdits', () => {
  it('drops the character the user actually backspaced on a CRLF note', () => {
    // The reported corruption: a backspace on the last line used to delete a
    // character three positions upstream ("Assist" -> "Asist" instead of
    // "Assis"), because the offset drifted by one per preceding line.
    const state = EditorState.create({ doc: INTENDED.join(CRLF) })
    const lastLine = state.doc.line(4)
    const { edits, next } = editsFor(state, { from: lastLine.to - 1, to: lastLine.to })

    const host = applyCmEdits(INTENDED.join(CRLF), edits, CRLF)

    expect(host.split(CRLF)[3]).toBe('- Steer Assis')
    expect(host).toBe(cmTextAs(next, CRLF))
  })

  it('translates inserted LF to the note EOL, never mixing line endings', () => {
    const text = ['alpha', 'beta'].join(CRLF)
    const edits: CmEdit[] = [{ from: { line: 0, ch: 5 }, to: { line: 0, ch: 5 }, insert: '\nmid' }]

    const out = applyCmEdits(text, edits, CRLF)

    expect(out).toBe(['alpha', 'mid', 'beta'].join(CRLF))
    expect(out.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r'))).toBe(true)
  })

  it('resolves every edit in a batch against the pre-edit text', () => {
    // A WorkspaceEdit resolves all its TextEdits against the original document,
    // which is also what iterChanges reports — so a batch must not let an
    // earlier splice shift a later one.
    const text = ['alpha', 'beta', 'gamma'].join(CRLF)
    const edits: CmEdit[] = [
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 }, insert: 'AAAAAAAAAA' },
      { from: { line: 2, ch: 0 }, to: { line: 2, ch: 5 }, insert: 'C' }
    ]

    expect(applyCmEdits(text, edits, CRLF)).toBe(['AAAAAAAAAA', 'beta', 'C'].join(CRLF))
  })

  it('handles LF notes identically', () => {
    const state = EditorState.create({ doc: INTENDED.join('\n') })
    const lastLine = state.doc.line(4)
    const { edits, next } = editsFor(state, { from: lastLine.to - 1, to: lastLine.to })

    expect(applyCmEdits(INTENDED.join('\n'), edits, '\n')).toBe(cmTextAs(next, '\n'))
  })

  it('clamps out-of-range positions instead of corrupting the tail', () => {
    const text = ['alpha', 'beta'].join(CRLF)
    const edits: CmEdit[] = [{ from: { line: 9, ch: 99 }, to: { line: 9, ch: 99 }, insert: '!' }]

    expect(applyCmEdits(text, edits, CRLF)).toBe(['alpha', 'beta!'].join(CRLF))
  })
})

describe('sync round trip stays byte-exact', () => {
  // The assertion that would have caught the original bug immediately: after
  // any sequence of edits, the text the host reconstructs must equal what
  // CodeMirror is showing. Run over both EOLs so neither can regress alone.
  for (const [name, eol] of [
    ['CRLF', CRLF],
    ['LF', '\n']
  ] as const) {
    it(`reconstructs the CodeMirror document exactly (${name})`, () => {
      let state = EditorState.create({ doc: INTENDED.join(eol) })
      let host = INTENDED.join(eol)

      // A spread of ordinary editing: typing mid-line, deleting at a line end,
      // splitting a line, joining two lines, and a multi-line paste — each on a
      // different line so any per-line offset drift compounds visibly.
      const steps: { from: number; to?: number; insert?: string }[] = [
        { from: state.doc.line(2).from + 2, insert: 'XY' },
        { from: state.doc.line(3).to - 1, to: state.doc.line(3).to },
        { from: state.doc.line(4).from + 7, insert: '\n' },
        { from: state.doc.line(1).to, to: state.doc.line(2).from },
        { from: state.doc.line(3).from, insert: 'one\ntwo\nthree' }
      ]

      for (const step of steps) {
        const { edits, next } = editsFor(state, step)
        host = applyCmEdits(host, edits, eol)
        state = next
        expect(host).toBe(cmTextAs(state, eol))
      }

      expect(host.includes('\r')).toBe(eol === CRLF)
    })
  }
})
