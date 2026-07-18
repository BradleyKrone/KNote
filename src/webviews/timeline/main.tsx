import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import { initStores } from '../shared/stores'
import { Toast } from '../shared/components/Toast'
import { TimelineApp } from './TimelineApp'

initStores()

createRoot(document.getElementById('root')!).render(
  <>
    <TimelineApp />
    <Toast />
  </>
)
