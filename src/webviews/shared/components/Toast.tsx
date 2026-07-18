import { useToastStore } from '../stores'

export function Toast(): React.JSX.Element | null {
  const message = useToastStore((s) => s.message)
  if (!message) return null
  return <div className="toast">{message}</div>
}
