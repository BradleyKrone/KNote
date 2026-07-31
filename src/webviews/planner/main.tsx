import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { initStores } from '../shared/stores'
import { Toast } from '../shared/components/Toast'
import { PlannerApp } from './PlannerApp'

initStores()

createRoot(document.getElementById('root')!).render(
  <>
    <PlannerApp />
    <Toast />
  </>
)
