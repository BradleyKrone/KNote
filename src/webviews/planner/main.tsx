import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { initStores } from '../shared/stores'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { Toast } from '../shared/components/Toast'
import { PlannerApp } from './PlannerApp'

initStores()

createRoot(document.getElementById('root')!).render(
  <>
    <PlannerApp />
    <ConfirmDialog />
    <Toast />
  </>
)
