import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
// The card pencil opens the same live-preview editor a note uses, so the board
// needs its `.cm-*` content styling too. After webview.css, so the `.cm-*`
// rules win; the editor's own page-shell CSS (editorShell.css) is *not*
// imported — that one sizes a whole webview.
import '../editor/editor.css'
import type { DeliverableScopeFilter } from '@shared/deliverables'
import { bootstrap, vscodeApi } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { ReasonDialog } from '../shared/components/ReasonDialog'
import { Toast } from '../shared/components/Toast'
import { BoardView } from './BoardView'
import { TaskNoteDialog } from './TaskNoteDialog'
import type { BoardScope } from './boardSelectors'

const { scope = { kind: 'global' }, initialFilter = null } = bootstrap<{
  scope?: BoardScope
  initialFilter?: DeliverableScopeFilter
}>()

// Persist the scope so VS Code's panel serializer can revive this board
// after a window reload.
vscodeApi.setState({ scope })

initStores()

createRoot(document.getElementById('root')!).render(
  <>
    <BoardView scope={scope} initialFilter={initialFilter} />
    {/* Before ConfirmDialog, so its own discard-changes prompt paints on top. */}
    <TaskNoteDialog />
    <ConfirmDialog />
    <ReasonDialog />
    <Toast />
  </>
)
