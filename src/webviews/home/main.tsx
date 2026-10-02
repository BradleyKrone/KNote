import { createRoot } from 'react-dom/client'
import '../shared/webview.css'
import './home.css'
import { initStores } from '../shared/stores'
import { Toast } from '../shared/components/Toast'
import { HomeApp } from './HomeApp'

initStores()

createRoot(document.getElementById('root')!).render(
  <>
    <HomeApp />
    <Toast />
  </>
)
