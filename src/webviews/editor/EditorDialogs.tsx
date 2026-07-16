// The small React overlay mounted beside the CodeMirror editor: the reason
// prompt (required when a checkbox click moves a task into a requireReason
// column) and the toast, both driven by the shared Zustand stores.

import { ReasonDialog } from '../shared/components/ReasonDialog'
import { Toast } from '../shared/components/Toast'

export function EditorDialogs(): React.JSX.Element {
  return (
    <>
      <ReasonDialog />
      <Toast />
    </>
  )
}
