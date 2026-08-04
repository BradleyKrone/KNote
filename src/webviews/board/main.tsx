import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import type { DeliverableScopeFilter } from '@shared/deliverables'
import { bootstrap, vscodeApi } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { ReasonDialog } from '../shared/components/ReasonDialog'
import { Toast } from '../shared/components/Toast'
import { BoardView } from './BoardView'
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
    <ConfirmDialog />
    <ReasonDialog />
    <Toast />
  </>
)
