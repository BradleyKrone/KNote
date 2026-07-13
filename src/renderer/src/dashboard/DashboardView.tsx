// The Dashboard tab: pinned notes, tasks currently "In Progress", and
// upcoming/overdue deadlines, all in one place. Opens as a normal tab (see
// workspaceStore's DASHBOARD_TAB_ID) so it can sit in a split pane next to a
// note, unlike the exclusive full-screen views (Board/Timeline/etc).

import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { CalendarClock, CheckCircle2, ExternalLink, FileText, Link2, PinOff, Plus, X } from 'lucide-react'
import type { VaultPath } from '@shared/types'
import { openWikiTarget, useIndexStore } from '@/stores/indexStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { formatTimeUntil, type TimelineItem } from '@/timeline/timelineSelectors'
import {
  findColumnByName,
  inProgressCards,
  isExternalLink,
  pinnedNoteEntries,
  upcomingDeadlines
} from './dashboardSelectors'

export function DashboardView({ paneIndex }: { paneIndex: number }): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const vaultConfig = useSettingsStore((s) => s.vaultConfig)
  const unpinNote = useSettingsStore((s) => s.unpinNote)
  const addLink = useSettingsStore((s) => s.addLink)
  const removeLink = useSettingsStore((s) => s.removeLink)

  const [addingLink, setAddingLink] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkTarget, setLinkTarget] = useState('')

  const today = dayjs().format('YYYY-MM-DD')

  const pinned = useMemo(
    () => pinnedNoteEntries(notes, vaultConfig.pinnedNotes),
    [notes, vaultConfig.pinnedNotes]
  )
  const hasInProgressColumn = useMemo(
    () => findColumnByName(vaultConfig.columns, 'In Progress') !== null,
    [vaultConfig.columns]
  )
  const working = useMemo(
    () => inProgressCards(notes, vaultConfig.columns),
    [notes, vaultConfig.columns]
  )
  const { overdue, upcoming } = useMemo(() => upcomingDeadlines(notes, today), [notes, today])

  const openNote = (path: VaultPath, line?: number): void => {
    void useWorkspaceStore.getState().openFileInPane(paneIndex, path, line)
  }

  const openLink = (target: string): void => {
    if (isExternalLink(target)) void window.knote.openExternal(target.trim())
    else void openWikiTarget(target)
  }

  const submitLink = (): void => {
    const label = linkLabel.trim()
    const target = linkTarget.trim()
    if (!label || !target) return
    void addLink(label, target)
    setLinkLabel('')
    setLinkTarget('')
    setAddingLink(false)
  }

  return (
    <div className="dashboard-view">
      <div className="board-header">
        <div className="board-title">Dashboard</div>
      </div>
      <div className="dashboard-scroll">
        <div className="dashboard-grid">
          <section className="dashboard-section">
            <h3 className="dashboard-section-title">Pinned notes</h3>
            {pinned.length === 0 ? (
              <div className="panel-empty">
                Right-click a note in the file explorer and choose “Pin to dashboard” to add it
                here.
              </div>
            ) : (
              <div className="dashboard-list">
                {pinned.map((entry) => (
                  <div
                    key={entry.path}
                    className="timeline-item"
                    onClick={() => !entry.missing && openNote(entry.path)}
                  >
                    <FileText size={14} className="timeline-item-icon" />
                    <span className="timeline-item-text">{entry.title}</span>
                    {entry.missing && <span className="board-card-due">missing</span>}
                    <button
                      className="board-card-action"
                      title="Unpin from dashboard"
                      onClick={(e) => {
                        e.stopPropagation()
                        void unpinNote(entry.path)
                      }}
                    >
                      <PinOff size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-section">
            <h3 className="dashboard-section-title">
              Current working task{working.length === 1 ? '' : 's'}
            </h3>
            {!hasInProgressColumn ? (
              <div className="panel-empty">
                No column named “In Progress” — configure one in Settings → Kanban board.
              </div>
            ) : working.length === 0 ? (
              <div className="panel-empty">Nothing in progress right now.</div>
            ) : (
              <div className="dashboard-list">
                {working.map((card) => (
                  <div
                    key={`${card.path}:${card.line}`}
                    className="timeline-item"
                    onClick={() => openNote(card.path, card.line)}
                  >
                    <CheckCircle2 size={14} className="timeline-item-icon" />
                    <span className="timeline-item-text">{card.displayText}</span>
                    <span className="timeline-item-note">{card.noteTitle}</span>
                    {card.tags.map((t) => (
                      <span key={t} className="board-card-tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-section dashboard-section-wide">
            <h3 className="dashboard-section-title">Links</h3>
            {vaultConfig.links.length === 0 && !addingLink && (
              <div className="panel-empty">
                Anything you find useful — a website, a note — one click away from here.
              </div>
            )}
            {vaultConfig.links.length > 0 && (
              <div className="dashboard-list">
                {vaultConfig.links.map((link) => (
                  <div key={link.id} className="timeline-item" onClick={() => openLink(link.target)}>
                    {isExternalLink(link.target) ? (
                      <ExternalLink size={14} className="timeline-item-icon" />
                    ) : (
                      <Link2 size={14} className="timeline-item-icon" />
                    )}
                    <span className="timeline-item-text">{link.label}</span>
                    <span className="timeline-item-note dashboard-link-target">{link.target}</span>
                    <button
                      className="board-card-action"
                      title="Remove link"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeLink(link.id)
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {addingLink ? (
              <div
                className="dashboard-add-link-form"
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitLink()
                  }
                  if (e.key === 'Escape') setAddingLink(false)
                }}
              >
                <input
                  className="panel-input small"
                  autoFocus
                  placeholder="Label"
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                />
                <input
                  className="panel-input small"
                  placeholder="https://… or a note name"
                  value={linkTarget}
                  onChange={(e) => setLinkTarget(e.target.value)}
                />
                <button className="board-card-action" title="Add link" onClick={submitLink}>
                  <Plus size={12} />
                </button>
                <button
                  className="board-card-action"
                  title="Cancel"
                  onClick={() => setAddingLink(false)}
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button className="board-add-btn" onClick={() => setAddingLink(true)}>
                <Plus size={14} /> Add link
              </button>
            )}
          </section>

          <section className="dashboard-section dashboard-section-wide">
            <h3 className="dashboard-section-title">Upcoming deadlines</h3>
            {overdue.length === 0 && upcoming.length === 0 ? (
              <div className="panel-empty">Nothing dated in the next couple weeks.</div>
            ) : (
              <>
                {overdue.length > 0 && (
                  <div className="dashboard-overdue-callout">
                    {overdue.length} overdue item{overdue.length === 1 ? '' : 's'}
                  </div>
                )}
                <div className="dashboard-list">
                  {[...overdue, ...upcoming].map((item: TimelineItem, i) => (
                    <div
                      key={`${item.path}-${item.line}-${i}`}
                      className="timeline-item"
                      onClick={() => openNote(item.path, item.kind !== 'note' ? item.line : undefined)}
                    >
                      <CalendarClock size={14} className="timeline-item-icon" />
                      <span className="timeline-item-text">{item.text}</span>
                      <span className="timeline-item-note">{item.noteTitle}</span>
                      <span
                        className={`timeline-item-countdown${item.date < today ? ' overdue' : ''}`}
                      >
                        {formatTimeUntil(item.date, today)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
