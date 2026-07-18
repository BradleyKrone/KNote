// The small React overlay mounted beside the CodeMirror editor: the right-click
// context menu, the reason prompt (required when a checkbox move enters a
// requireReason column) and the toast. The menu needs the EditorView; the
// dialogs are driven by the shared Zustand stores.

import type { EditorView } from '@codemirror/view'
import { ReasonDialog } from '../shared/components/ReasonDialog'
import { Toast } from '../shared/components/Toast'
import { EditorContextMenu } from './EditorContextMenu'

export function EditorDialogs({ view }: { view: EditorView }): React.JSX.Element {
  return (
    <>
      <EditorContextMenu view={view} />
      <ReasonDialog />
      <Toast />
    </>
  )
}
