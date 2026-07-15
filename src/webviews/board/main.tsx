import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { bootstrap, vscodeApi } from '../shared/rpc'
import { initStores } from '../shared/stores'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { ReasonDialog } from '../shared/components/ReasonDialog'
import { Toast } from '../shared/components/Toast'
import { BoardView } from './BoardView'
import type { BoardScope } from './boardSelectors'

const { scope = { kind: 'global' } } = bootstrap<{ scope?: BoardScope }>()

// Persist the scope so VS Code's panel serializer can revive this board
// after a window reload.
vscodeApi.setState({ scope })

initStores()

createRoot(document.getElementById('root')!).render(
  <>
    <BoardView scope={scope} />
    <ConfirmDialog />
    <ReasonDialog />
    <Toast />
  </>
)
