import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { initStores } from '../shared/stores'
import { ConfirmDialog } from '../shared/components/ConfirmDialog'
import { Toast } from '../shared/components/Toast'
import { SettingsApp } from './SettingsApp'

initStores()

createRoot(document.getElementById('root')!).render(
  <>
    <SettingsApp />
    <ConfirmDialog />
    <Toast />
  </>
)
