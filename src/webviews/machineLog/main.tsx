import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { initStores } from '../shared/stores'
import { installInputSpellCheck } from '../shared/spellcheck/inputSpellCheck'
import { Toast } from '../shared/components/Toast'
import { MachineLogApp } from './MachineLogApp'

initStores()
installInputSpellCheck()

createRoot(document.getElementById('root')!).render(
  <>
    <MachineLogApp />
    <Toast />
  </>
)
