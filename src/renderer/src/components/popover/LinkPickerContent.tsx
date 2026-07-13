import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Pre-filled label — the selected text at the time the menu was opened, if any. */
  initialText?: string
  onSubmit: (url: string, text: string) => void
}

/** Popover for the editor's "Insert link…" context-menu item: a URL and an
 *  optional display text, inserted as `[text](url)` at the cursor/selection. */
export function LinkPickerContent({ initialText = '', onSubmit }: Props): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [text, setText] = useState(initialText)
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => urlRef.current?.focus(), 0)
  }, [])

  const submit = (): void => {
    const trimmed = url.trim()
    if (trimmed) onSubmit(trimmed, text)
  }

  return (
    <div className="picker link-picker">
      <div className="picker-field">
        <label className="picker-field-label">URL</label>
        <input
          ref={urlRef}
          className="panel-input small"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </div>
      <div className="picker-field">
        <label className="picker-field-label">Text</label>
        <input
          className="panel-input small"
          placeholder="Link text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </div>
      <button className="btn-primary picker-submit" disabled={!url.trim()} onClick={submit}>
        Insert link
      </button>
    </div>
  )
}
