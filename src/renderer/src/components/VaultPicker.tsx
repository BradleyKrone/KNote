import { FolderOpen } from 'lucide-react'
import { useVaultStore } from '@/stores/vaultStore'

export function VaultPicker(): React.JSX.Element {
  const setVault = useVaultStore((s) => s.setVault)

  const pick = async (): Promise<void> => {
    const info = await window.knote.pickVault()
    if (info) setVault(info)
  }

  return (
    <div className="vault-picker">
      <div className="vault-picker-card">
        <h1>KNote</h1>
        <p>Your notes live in a vault — a plain folder of Markdown files on your computer.</p>
        <button className="btn-primary" onClick={() => void pick()}>
          <FolderOpen size={18} />
          Open vault folder
        </button>
      </div>
    </div>
  )
}
