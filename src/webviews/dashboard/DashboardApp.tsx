// The Home dashboard: everything you need for the day on one page — task
// stats, overdue alerts, upcoming deadlines, what you're working on, this
// week's note, milestones, pinned outside links, and a quick-capture box.
// All data comes from the live note index and vault config; nothing here
// reaches the network (external links are handed to VS Code to open).

import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  Circle,
  ExternalLink,
  Flag,
  Link2,
  ListTodo,
  Plus,
  Send,
  Sunrise,
  X
} from 'lucide-react'
import type { Bookmark } from '@shared/types'
import { host } from '../shared/rpc'
import { showToast, useConfigStore, useIndexStore } from '../shared/stores'
import { formatTimeUntil, type TimelineItem } from '../timeline/timelineSelectors'
import type { BoardCard } from '../board/boardSelectors'
import {
  dayHeadingLabel,
  extractDaySection,
  inProgressCards,
  overdueDeadlines,
  taskStats,
  thisWeekNotePath,
  upcomingDeadlines,
  type DaySection
} from './dashboardSelectors'

function greeting(hour: number): string {
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function openTimelineItem(item: TimelineItem): void {
  void host.openNote(item.path, item.kind !== 'note' ? item.line : undefined)
}

export function DashboardApp(): React.JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const config = useConfigStore((s) => s.vaultConfig)

  const now = dayjs()
  const today = now.format('YYYY-MM-DD')
  const yesterday = now.subtract(1, 'day').format('YYYY-MM-DD')

  const stats = useMemo(() => taskStats(notes, config.columns, today), [notes, config.columns, today])
  const upcoming = useMemo(() => upcomingDeadlines(notes, today, 6), [notes, today])
  const overdue = useMemo(() => overdueDeadlines(notes, today), [notes, today])
  const working = useMemo(() => inProgressCards(notes, config.columns), [notes, config.columns])
  const milestones = useMemo(
    () =>
      upcomingDeadlines(notes, today, 30).filter((i) => i.kind === 'milestone').slice(0, 6),
    [notes, today]
  )

  const weekPath = useMemo(() => thisWeekNotePath(config, now), [config, now])
  const weekMeta = notes.get(weekPath)
  const weekMtime = weekMeta?.mtimeMs
  const [weekContent, setWeekContent] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (weekMtime === undefined) {
      setWeekContent(null)
      return
    }
    void host
      .readFile(weekPath)
      .then((res) => live && setWeekContent(res.content))
      .catch(() => live && setWeekContent(null))
    return () => {
      live = false
    }
  }, [weekPath, weekMtime])

  const todaySection =
    weekContent && weekMeta ? extractDaySection(weekContent, weekMeta.headings, dayHeadingLabel(today)) : null
  const yesterdaySection =
    weekContent && weekMeta
      ? extractDaySection(weekContent, weekMeta.headings, dayHeadingLabel(yesterday))
      : null

  const openWeek = (): void => void host.openWikiTarget(weekPath.replace(/\.md$/, ''))

  return (
    <div className="dash-view">
      <header className="dash-header">
        <div className="dash-greeting">
          <Sunrise size={22} className="dash-greeting-icon" />
          <div>
            <div className="dash-hello">{greeting(now.hour())}</div>
            <div className="dash-date">{now.format('dddd, MMMM D, YYYY')}</div>
          </div>
        </div>
        <button className="btn-primary" onClick={openWeek}>
          <CalendarDays size={14} /> This week's note
        </button>
      </header>

      <div className="dash-scroll">
        <StatsStrip stats={stats} />

        {overdue.length > 0 && <OverdueCallout items={overdue} today={today} />}

        <div className="dash-grid">
          <DeadlinesCard items={upcoming} today={today} />
          <WorkingCard cards={working} />
          <WeekCard
            hasNote={!!weekMeta}
            today={todaySection}
            yesterday={yesterdaySection}
            onOpen={openWeek}
          />
          <MilestonesCard items={milestones} today={today} />
          <ResourcesCard bookmarks={config.bookmarks ?? []} />
          <CaptureCard />
        </div>
      </div>
    </div>
  )
}

// ---------- Stats ----------

function StatsStrip({ stats }: { stats: ReturnType<typeof taskStats> }): React.JSX.Element {
  return (
    <div className="dash-stats">
      <div className="dash-stat accent">
        <div className="dash-stat-num">{stats.open}</div>
        <div className="dash-stat-label">Open</div>
      </div>
      {stats.columns.map((c) => (
        <div className="dash-stat" key={c.name}>
          <div className="dash-stat-num">{c.count}</div>
          <div className="dash-stat-label">{c.name}</div>
        </div>
      ))}
      <div className={`dash-stat${stats.overdue > 0 ? ' danger' : ''}`}>
        <div className="dash-stat-num">{stats.overdue}</div>
        <div className="dash-stat-label">Overdue</div>
      </div>
    </div>
  )
}

// ---------- Overdue callout ----------

function OverdueCallout({ items, today }: { items: TimelineItem[]; today: string }): React.JSX.Element {
  return (
    <div className="dash-overdue">
      <div className="dash-overdue-head">
        <AlertTriangle size={15} />
        {items.length} overdue {items.length === 1 ? 'item' : 'items'}
      </div>
      <div className="dash-overdue-list">
        {items.map((item, i) => (
          <button
            key={`${item.path}-${item.line}-${i}`}
            className="dash-overdue-row"
            onClick={() => openTimelineItem(item)}
          >
            <span className="dash-overdue-text">{item.text}</span>
            <span className="dash-overdue-when">{formatTimeUntil(item.date, today)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Card shell ----------

function Card({
  title,
  icon,
  action,
  children
}: {
  title: string
  icon: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <span className="dash-card-title">
          {icon}
          {title}
        </span>
        {action}
      </div>
      <div className="dash-card-body">{children}</div>
    </section>
  )
}

// ---------- Deadlines ----------

function DeadlinesCard({ items, today }: { items: TimelineItem[]; today: string }): React.JSX.Element {
  return (
    <Card title="Upcoming deadlines" icon={<CalendarClock size={15} />}>
      {items.length === 0 ? (
        <div className="panel-empty">Nothing due. Add 📅 2026-07-15 to a task or a due:/deadline: to a note.</div>
      ) : (
        items.map((item, i) => (
          <button
            key={`${item.path}-${item.line}-${i}`}
            className="dash-row"
            onClick={() => openTimelineItem(item)}
          >
            <span className="dash-row-icon">
              {item.kind === 'milestone' ? <Flag size={13} /> : <Circle size={13} />}
            </span>
            <span className="dash-row-text">{item.text}</span>
            <span className={`dash-when${item.date === today ? ' soon' : ''}`}>
              {formatTimeUntil(item.date, today)}
            </span>
          </button>
        ))
      )}
    </Card>
  )
}

// ---------- Current work ----------

function WorkingCard({ cards }: { cards: BoardCard[] }): React.JSX.Element {
  return (
    <Card title="Working on" icon={<ListTodo size={15} />}>
      {cards.length === 0 ? (
        <div className="panel-empty">Nothing in progress. Move a task to In Progress (Ctrl+L) to see it here.</div>
      ) : (
        cards.map((card) => (
          <button
            key={`${card.path}-${card.line}`}
            className="dash-row"
            onClick={() => void host.openNote(card.path, card.line)}
          >
            <span className="dash-row-icon">
              <Circle size={13} />
            </span>
            <span className="dash-row-text">{card.displayText}</span>
            <span className="dash-row-note">{card.noteTitle}</span>
          </button>
        ))
      )}
    </Card>
  )
}

// ---------- This week ----------

function WeekCard({
  hasNote,
  today,
  yesterday,
  onOpen
}: {
  hasNote: boolean
  today: DaySection | null
  yesterday: DaySection | null
  onOpen: () => void
}): React.JSX.Element {
  const action = (
    <button className="dash-card-action" onClick={onOpen} title="Open this week's note">
      Open <ArrowUpRight size={13} />
    </button>
  )
  return (
    <Card title="This week" icon={<CalendarDays size={15} />} action={action}>
      {!hasNote ? (
        <div className="panel-empty">
          No note for this week yet. <button className="dash-link" onClick={onOpen}>Create it</button>.
        </div>
      ) : !today && !yesterday ? (
        <div className="panel-empty">Nothing logged under today's or yesterday's heading yet.</div>
      ) : (
        <>
          <DayBlock label="Today" section={today} />
          <DayBlock label="Yesterday" section={yesterday} />
        </>
      )}
    </Card>
  )
}

function DayBlock({ label, section }: { label: string; section: DaySection | null }): React.JSX.Element | null {
  if (!section || section.body.length === 0) return null
  return (
    <div className="dash-day">
      <div className="dash-day-label">{label}</div>
      {section.body.map((line, i) => (
        <div className="dash-day-line" key={i}>
          {line || ' '}
        </div>
      ))}
    </div>
  )
}

// ---------- Milestones ----------

function MilestonesCard({ items, today }: { items: TimelineItem[]; today: string }): React.JSX.Element {
  return (
    <Card title="Upcoming milestones" icon={<Flag size={15} />}>
      {items.length === 0 ? (
        <div className="panel-empty">No milestones ahead. Add 🏁 Milestone 📅 2026-07-15 to any note.</div>
      ) : (
        items.map((item, i) => (
          <button
            key={`${item.path}-${item.line}-${i}`}
            className={`dash-row${item.important ? ' important' : ''}`}
            onClick={() => openTimelineItem(item)}
          >
            <span className="dash-row-icon">
              <Flag size={13} />
            </span>
            <span className="dash-row-text">{item.text}</span>
            <span className="dash-when">{formatTimeUntil(item.date, today)}</span>
          </button>
        ))
      )}
    </Card>
  )
}

// ---------- Resources (bookmarks) ----------

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function ResourcesCard({ bookmarks }: { bookmarks: Bookmark[] }): React.JSX.Element {
  const config = useConfigStore((s) => s.vaultConfig)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)

  const save = async (next: Bookmark[]): Promise<void> => {
    await host.setVaultConfig({ ...config, bookmarks: next })
  }

  const add = (): void => {
    const cleanUrl = normalizeUrl(url)
    if (!cleanUrl) return
    void save([...bookmarks, { label: label.trim() || cleanUrl, url: cleanUrl }])
    setLabel('')
    setUrl('')
    setAdding(false)
  }

  const remove = (i: number): void => void save(bookmarks.filter((_, j) => j !== i))

  const action = (
    <button className="dash-card-action" onClick={() => setAdding((a) => !a)} title="Add a link">
      <Plus size={14} />
    </button>
  )

  return (
    <Card title="Resources" icon={<Link2 size={15} />} action={action}>
      {bookmarks.length === 0 && !adding && (
        <div className="panel-empty">No links yet. Click + to pin an outside resource.</div>
      )}
      {bookmarks.map((b, i) => (
        <div className="dash-link-row" key={`${b.url}-${i}`}>
          <button
            className="dash-link-open"
            onClick={() => void host.openExternal(b.url)}
            title={b.url}
          >
            <ExternalLink size={13} />
            <span className="dash-link-label">{b.label}</span>
          </button>
          <button className="dash-link-remove" onClick={() => remove(i)} title="Remove">
            <X size={13} />
          </button>
        </div>
      ))}
      {adding && (
        <div className="dash-add-link">
          <input
            className="panel-input small"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            className="panel-input small"
            placeholder="https://…"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn-primary" onClick={add} disabled={!url.trim()}>
            Add
          </button>
        </div>
      )}
    </Card>
  )
}

// ---------- Quick capture ----------

function CaptureCard(): React.JSX.Element {
  const [text, setText] = useState('')

  const capture = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    void host.quickCapture(trimmed).then(() => showToast("Captured to this week's note"))
    setText('')
  }

  return (
    <Card title="Quick capture" icon={<Send size={15} />}>
      <div className="dash-capture">
        <input
          className="panel-input"
          placeholder="Jot something for this week…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && capture()}
        />
        <button className="btn-primary" onClick={capture} disabled={!text.trim()}>
          <Send size={13} /> Capture
        </button>
      </div>
    </Card>
  )
}
