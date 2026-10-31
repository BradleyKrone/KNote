import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { initStores } from '../shared/stores'
import { installInputSpellCheck } from '../shared/spellcheck/inputSpellCheck'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { Toast } from '../shared/components/Toast'
import { PlannerApp } from './PlannerApp'

initStores()
installInputSpellCheck()

createRoot(document.getElementById('root')!).render(
  <>
    <PlannerApp />
    <ConfirmDialog />
    <Toast />
  </>
)
