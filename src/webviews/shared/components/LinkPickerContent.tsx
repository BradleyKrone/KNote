import { useState } from 'react'
import { isExternalUrl } from '@shared/externalUrl'

interface Props {
  /** Called with the display text and the URL when the user confirms. */
  onSubmit: (text: string, url: string) => void
  /** Pre-fill — the current selection when inserting, the link's own parts when editing. */
  initialText?: string
  initialUrl?: string
  /** Submit button label — defaults to "Insert link". */
  submitLabel?: string
}

/** Popover for entering/editing a `[text](url)` hyperlink. */
export function LinkPickerContent({
  onSubmit,
  initialText = '',
  initialUrl = '',
  submitLabel = 'Insert link'
}: Props): React.JSX.Element {
  const [text, setText] = useState(initialText)
  const [url, setUrl] = useState(initialUrl)

  const trimmedUrl = url.trim()
  // Bare domains are the common case when pasting — treat `example.com` as
  // https rather than writing a link that can't be opened.
  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
  const valid = trimmedUrl.length > 0 && isExternalUrl(normalized)

  const submit = (): void => {
    if (valid) onSubmit(text, normalized)
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit()
  }

  return (
    <div className="picker link-picker">
      <div className="picker-field">
        <label className="picker-field-label">Link text</label>
        <input
          className="panel-input small"
          placeholder="Shown in the note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="picker-field">
        <label className="picker-field-label">URL</label>
        <input
          className="panel-input small"
          placeholder="https://example.com"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {trimmedUrl.length > 0 && !valid && (
          <div className="picker-field-error">Needs an http, https or mailto address</div>
        )}
      </div>
      <button className="btn-primary picker-submit" disabled={!valid} onClick={submit}>
        {submitLabel}
      </button>
    </div>
  )
}
