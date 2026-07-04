import type { MachineDef } from '@shared/types'
import { configCodes } from '@/machineLog/machineLogSelectors'

/** Renders a machine's registered model + attributes as small chips, or an "unregistered" hint. */
export function MachineConfigChips({ def }: { def: MachineDef | undefined }): React.JSX.Element | null {
  if (!def) return <span className="machine-unregistered">unregistered</span>
  const codes = configCodes(def)
  if (codes.length === 0) return null
  return (
    <>
      {codes.map((c) => (
        <span key={c} className="machine-config-chip">
          {c}
        </span>
      ))}
    </>
  )
}

