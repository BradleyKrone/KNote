import { useEffect, useState } from 'react'
import type { SearchResult } from '@shared/types'
import { useUiStore } from '@/stores/uiStore'
import { useIndexStore } from '@/stores/indexStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'

export function SearchPanel(): React.JSX.Element {
  const query = useUiStore((s) => s.searchQuery)
  const setQuery = useUiStore((s) => s.setSearchQuery)
  const notes = useIndexStore((s) => s.notes) // re-run search when the vault changes
  const [results, setResults] = useState<SearchResult[]>([])
  const [ran, setRan] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim() === '') {
        setResults([])
        setRan(false)
        return
      }
      void window.knote.searchVault(query).then((r) => {
        setResults(r)
        setRan(true)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [query, notes])

  return (
    <div className="side-panel">
      <div className="side-panel-search">
        <input
          className="panel-input"
          placeholder={'Search  (path: tag: file: -term "phrase")'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="side-panel-body">
        {ran && results.length === 0 && <div className="panel-empty">No results</div>}
        {results.map((r) => (
          <div
            key={r.path}
            className="search-result"
            onClick={() =>
              void useWorkspaceStore.getState().openFile(r.path, r.snippet?.line)
            }
          >
            <div className="search-result-title">{r.title}</div>
            {r.snippet && <div className="search-result-snippet">{r.snippet.text}</div>}
            <div className="search-result-path">{r.path}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
