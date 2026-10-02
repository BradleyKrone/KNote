// The KNote Home page: a greeting, quick actions, and four cards — the last day
// you journaled, what's in progress, what's due, and what's coming up on the
// planner. Everything but the previous-day text is derived in the webview from
// the mirrored index (homeSelectors.ts); the previous day comes from the host,
// which has the notes' text.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import type { HomeCommand } from '@shared/hostApi'
import type { PreviousDay } from '@shared/previousDay'
import { isInside, titleOf } from '@shared/pathUtils'
import { createRenderer } from '@shared/renderMarkdown'
import { host, on } from '../shared/rpc'
import { showToast, useConfigStore, useIndexStore, useMountsStore } from '../shared/stores'
import { formatTimeUntil } from '../shared/dates'
import { dueState, type BoardCard, type DueState } from '../board/boardSelectors'
import {
  daysSince,
  dueBuckets,
  inProgressCards,
  inProgressColumn,
  spanInWindow,
  upcomingPlanner,
  type UpcomingDeliverable,
  type UpcomingMilestone
} from './homeSelectors'

dayjs.extend(isoWeek)

const todayStr = (): string => dayjs().format('YYYY-MM-DD')

/** Today's date, re-checked every minute so a page left open overnight rolls over. */
function useToday(): string {
  const [today, setToday] = useState(todayStr)
  useEffect(() => {
    const timer = setInterval(() => setToday(todayStr()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Working late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const open = (path: string, line?: number): void => void host.openNote(path, line)

function run(command: HomeCommand): void {
  host.runCommand(command).catch((err: unknown) => {
    showToast(err instanceof Error ? err.message : String(err))
  })
}

// ---------- Icons (inline, so nothing loads from anywhere) ----------

function Icon({ d, size = 16 }: { d: string; size?: number }): JSX.Element {
  return (
    <svg
      className="home-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  journal: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM4 17a3 3 0 0 1 3-3h11M8 8h6',
  progress: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2M17 3h4v4M21 3l-6 6',
  due: 'M12 8v4l2.5 2.5M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
  planner: 'M3 6h18M3 12h18M3 18h18M7 4v4M14 10v4M10 16v4',
  week: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  capture: 'M12 5v14M5 12h14',
  flag: 'M5 21V4h11l-2 4 2 4H5'
}

// ---------- Building blocks ----------

function Card({
  title,
  icon,
  accent,
  count,
  action,
  wide,
  children
}: {
  title: string
  icon: string
  accent: string
  count?: number
  action?: ReactNode
  wide?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <section
      className={`home-card${wide ? ' home-card-wide' : ''}`}
      style={{ ['--accent' as string]: accent }}
    >
      <header className="home-card-head">
        <span className="home-card-icon">
          <Icon d={icon} />
        </span>
        <h2>{title}</h2>
        {count !== undefined && count > 0 && <span className="home-badge">{count}</span>}
        <span className="home-card-spacer" />
        {action}
      </header>
      <div className="home-card-body">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="home-empty">{children}</div>
}

const DUE_LABEL: Record<DueState, string> = {
  overdue: 'overdue',
  today: 'due today',
  soon: 'due soon',
  later: 'due'
}

function DueChip({
  date,
  state,
  today
}: {
  date: string
  state: DueState
  today: string
}): JSX.Element {
  return (
    <span className={`home-chip home-chip-${state}`} title={`${DUE_LABEL[state]} · ${date}`}>
      {formatTimeUntil(date, today)}
    </span>
  )
}

function Priority({ level }: { level: number }): JSX.Element | null {
  if (level <= 0) return null
  return (
    <span
      className={`home-priority home-priority-${Math.min(level, 3)}`}
      title={`Priority ${level}`}
    >
      {'!'.repeat(Math.min(level, 3))}
    </span>
  )
}

function TaskRow({
  card,
  today,
  extra
}: {
  card: BoardCard
  today: string
  extra?: ReactNode
}): JSX.Element {
  const due = dueState(card, today)
  return (
    <button className="home-row" onClick={() => open(card.path, card.line)} title={card.text}>
      <span className="home-row-main">
        <span className="home-row-text">
          <Priority level={card.priority} />
          {card.displayText || card.text}
        </span>
        <span className="home-row-sub">{card.noteTitle}</span>
      </span>
      <span className="home-row-meta">
        {extra}
        {card.due && due && <DueChip date={card.due} state={due} today={today} />}
      </span>
    </button>
  )
}

// ---------- Hero ----------

function Hero({ today }: { today: string }): JSX.Element {
  const now = dayjs()
  // How far through Mon–Sun we are, counting today's elapsed hours.
  const weekProgress = (now.isoWeekday() - 1 + (now.hour() * 60 + now.minute()) / 1440) / 7
  return (
    <header className="home-hero">
      <div className="home-hero-text">
        <div className="home-hero-eyebrow">
          {dayjs(today).format('dddd')} · Week {now.isoWeek()}
        </div>
        <h1>{greeting()}</h1>
        <div className="home-hero-date">{dayjs(today).format('MMMM D, YYYY')}</div>
        <div className="home-week" title={`${Math.round(weekProgress * 100)}% through the week`}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span
              key={i}
              className={
                'home-week-day' +
                (i < now.isoWeekday() - 1 ? ' past' : '') +
                (i === now.isoWeekday() - 1 ? ' current' : '')
              }
            >
              {d}
            </span>
          ))}
        </div>
      </div>
      <nav className="home-actions">
        <button className="home-action primary" onClick={() => run('knote.openWeeklyNote')}>
          <Icon d={ICONS.week} /> This Week
        </button>
        <button className="home-action" onClick={() => run('knote.openBoard')}>
          <Icon d={ICONS.board} /> Board
        </button>
        <button className="home-action" onClick={() => run('knote.openPlanner')}>
          <Icon d={ICONS.planner} /> Planner
        </button>
        <button className="home-action" onClick={() => run('knote.quickCapture')}>
          <Icon d={ICONS.capture} /> Quick Capture
        </button>
      </nav>
    </header>
  )
}

// ---------- Previous day ----------

const renderer = createRenderer({ wikiHref: () => '#knote-home-link' })

/** Rendered day section, with `[ ]` / `[x]` list items drawn as checkboxes. */
function renderDay(content: string): string {
  return renderer
    .render(content)
    .replace(
      /<li>(<p>)?\[([ xX/])\]\s?/g,
      (_m, p: string | undefined, ch: string) =>
        `<li class="home-check${ch === ' ' ? '' : ch === '/' ? ' partial' : ' done'}">${p ?? ''}<span class="home-box"></span>`
    )
}

function PreviousDayCard({ today }: { today: string }): JSX.Element {
  const weeklyFolder = useConfigStore((s) => s.vaultConfig.weeklyFolder)
  const [day, setDay] = useState<PreviousDay | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      host
        .getPreviousDay()
        .then((d) => alive && setDay(d))
        .catch(() => alive && setDay(null))
    }
    load()
    const offs = [
      on('indexDelta', (delta) => {
        if (isInside(delta.path, weeklyFolder)) load()
      }),
      on('indexReady', load),
      on('configChanged', load)
    ]
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
  }, [today, weeklyFolder])

  const html = useMemo(() => (day ? renderDay(day.content) : ''), [day])
  const label = day ? dayjs(day.date).format('dddd, MMM D') : 'Previous day'

  return (
    <Card
      title={label}
      icon={ICONS.journal}
      accent="var(--home-violet)"
      action={
        day && (
          <button className="home-link" onClick={() => open(day.path, day.line)}>
            {titleOf(day.path)} ↗
          </button>
        )
      }
    >
      {day === undefined ? (
        <Empty>Loading…</Empty>
      ) : day === null ? (
        <Empty>
          Nothing written under a day heading in the last two weeks. Your weekly note's{' '}
          <code>### M/D/YYYY</code> sections show up here.
        </Empty>
      ) : (
        <>
          {day.date !== dayjs(today).subtract(1, 'day').format('YYYY-MM-DD') && (
            <div className="home-note">Last entry · {formatTimeUntil(day.date, today)}</div>
          )}
          <div
            className="home-markdown"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a.knote-wikilink')
              const target = a?.getAttribute('data-knote-target')
              if (target) {
                e.preventDefault()
                void host.openWikiTarget(target)
              }
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </>
      )}
    </Card>
  )
}

// ---------- In progress ----------

function InProgressCard({
  cards,
  today,
  hasColumn
}: {
  cards: BoardCard[]
  today: string
  hasColumn: boolean
}): JSX.Element {
  return (
    <Card title="In Progress" icon={ICONS.progress} accent="var(--home-blue)" count={cards.length}>
      {!hasColumn ? (
        <Empty>No In Progress column — give one a `/` status char in KNote Settings.</Empty>
      ) : cards.length === 0 ? (
        <Empty>Nothing in progress. Pick something from the board!</Empty>
      ) : (
        <div className="home-list">
          {cards.map((card) => {
            const days = daysSince(card.statusChanged, today)
            return (
              <TaskRow
                key={`${card.path}:${card.line}`}
                card={card}
                today={today}
                extra={
                  days !== null && (
                    <span className="home-age" title={`In progress since ${card.statusChanged}`}>
                      {days === 0 ? 'started today' : `${days}d`}
                    </span>
                  )
                }
              />
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ---------- Due ----------

function DueCard({ today }: { today: string }): JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const config = useConfigStore((s) => s.vaultConfig)
  const mountNames = useMountsStore((s) => s.mountNames)
  const buckets = useMemo(
    () => dueBuckets(notes, config, mountNames, today),
    [notes, config, mountNames, today]
  )
  const groups: { key: string; label: string; cards: BoardCard[]; followUp?: boolean }[] = [
    { key: 'overdue', label: 'Overdue', cards: buckets.overdue },
    { key: 'today', label: 'Today', cards: buckets.today },
    { key: 'followUps', label: 'Follow-ups due', cards: buckets.followUps, followUp: true },
    { key: 'soon', label: 'Next 7 days', cards: buckets.soon }
  ]
  const total =
    buckets.overdue.length + buckets.today.length + buckets.followUps.length + buckets.soon.length

  return (
    <Card
      title="Due & Overdue"
      icon={ICONS.due}
      accent={buckets.overdue.length > 0 ? 'var(--home-red)' : 'var(--home-amber)'}
      count={total}
    >
      {total === 0 ? (
        <Empty>Nothing due this week. Enjoy the breathing room.</Empty>
      ) : (
        groups
          .filter((g) => g.cards.length > 0)
          .map((g) => (
            <div key={g.key} className={`home-group home-group-${g.key}`}>
              <div className="home-group-label">
                {g.label} <span>{g.cards.length}</span>
              </div>
              <div className="home-list">
                {g.cards.map((card) => (
                  <TaskRow
                    key={`${card.path}:${card.line}`}
                    card={card}
                    today={today}
                    extra={
                      g.followUp &&
                      card.waitingFollowUp && (
                        <span
                          className="home-chip home-chip-followup"
                          title={card.waitingReason ?? ''}
                        >
                          follow up {formatTimeUntil(card.waitingFollowUp, today)}
                        </span>
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))
      )}
    </Card>
  )
}

// ---------- Planner ----------

const TIMELINE_DAYS = 14
const TIMELINE_ROWS = 6

function Timeline({
  today,
  deliverables,
  milestones
}: {
  today: string
  deliverables: UpcomingDeliverable[]
  milestones: UpcomingMilestone[]
}): JSX.Element {
  // One day of context behind today, so "today" never sits flush on the edge.
  const windowStart = dayjs(today).subtract(1, 'day')
  const days = Array.from({ length: TIMELINE_DAYS }, (_, i) => windowStart.add(i, 'day'))
  const ws = windowStart.format('YYYY-MM-DD')
  const rows = deliverables
    .map((d) => ({ d, span: spanInWindow(d.start, d.end, ws, TIMELINE_DAYS) }))
    .filter((r) => r.span !== null)
    .slice(0, TIMELINE_ROWS)
  const pins = milestones
    .map((m) => ({ m, span: spanInWindow(m.date, m.date, ws, TIMELINE_DAYS) }))
    .filter((p) => p.span !== null)

  return (
    <div className="home-timeline" style={{ ['--days' as string]: TIMELINE_DAYS }}>
      <div className="home-tl-ruler">
        {days.map((d) => {
          const iso = d.format('YYYY-MM-DD')
          return (
            <div
              key={iso}
              className={
                'home-tl-day' +
                (d.isoWeekday() >= 6 ? ' weekend' : '') +
                (iso === today ? ' today' : '')
              }
            >
              <span>{d.format('dd').charAt(0)}</span>
              <b>{d.format('D')}</b>
            </div>
          )
        })}
      </div>
      <div className="home-tl-body">
        <div className="home-tl-grid">
          {days.map((d) => (
            <div
              key={d.format('YYYY-MM-DD')}
              className={
                'home-tl-col' +
                (d.isoWeekday() >= 6 ? ' weekend' : '') +
                (d.format('YYYY-MM-DD') === today ? ' today' : '')
              }
            />
          ))}
        </div>
        {pins.length > 0 && (
          <div className="home-tl-row home-tl-pins">
            {pins.map(({ m, span }) => (
              <button
                key={m.id}
                className={`home-tl-pin${m.important ? ' important' : ''}`}
                style={{ left: `calc(${(span!.left + span!.width / 2) * 100}% - 6px)` }}
                title={`🏁 ${m.label} · ${m.date}`}
                onClick={() => open(m.path, m.line)}
              />
            ))}
          </div>
        )}
        {rows.length === 0 && pins.length === 0 ? (
          <div className="home-tl-empty">Nothing scheduled in the next two weeks</div>
        ) : (
          rows.map(({ d, span }) => (
            <div key={d.id} className="home-tl-row">
              <button
                className={`home-tl-bar${d.overdue ? ' overdue' : ''}`}
                style={{ left: `${span!.left * 100}%`, width: `${span!.width * 100}%` }}
                title={`${d.label} · ${d.start} → ${d.end} · ${d.percent}%`}
                onClick={() => open(d.path, d.line)}
              >
                <span className="home-tl-fill" style={{ width: `${d.percent}%` }} />
                <span className="home-tl-label">{d.label}</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ProgressRing({ percent, overdue }: { percent: number; overdue?: boolean }): JSX.Element {
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <svg
      className={`home-ring${overdue ? ' overdue' : ''}`}
      width="24"
      height="24"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r={r} className="home-ring-track" />
      <circle
        cx="12"
        cy="12"
        r={r}
        className="home-ring-value"
        strokeDasharray={`${(percent / 100) * c} ${c}`}
        transform="rotate(-90 12 12)"
      />
      <text x="12" y="12" dy="0.35em" textAnchor="middle">
        {percent}
      </text>
    </svg>
  )
}

function PlannerCard({ today }: { today: string }): JSX.Element {
  const notes = useIndexStore((s) => s.notes)
  const hiddenProjects = useConfigStore((s) => s.vaultConfig.hiddenProjects)
  const upcoming = useMemo(
    () => upcomingPlanner(notes, hiddenProjects, today),
    [notes, hiddenProjects, today]
  )
  type Item = UpcomingDeliverable | UpcomingMilestone
  const items: Item[] = [...upcoming.overdue, ...upcoming.deliverables, ...upcoming.milestones]
    .sort((a, b) => {
      const aOver = a.kind === 'deliverable' && a.overdue ? 0 : 1
      const bOver = b.kind === 'deliverable' && b.overdue ? 0 : 1
      const date = (x: Item): string => (x.kind === 'deliverable' ? x.end : x.date)
      return aOver - bOver || date(a).localeCompare(date(b))
    })
    .slice(0, 10)

  return (
    <Card
      title="Upcoming on the Planner"
      icon={ICONS.planner}
      accent="var(--home-green)"
      count={upcoming.overdue.length + upcoming.deliverables.length + upcoming.milestones.length}
      wide
      action={
        <button className="home-link" onClick={() => run('knote.openPlanner')}>
          Open planner ↗
        </button>
      }
    >
      <Timeline
        today={today}
        deliverables={[...upcoming.overdue, ...upcoming.deliverables]}
        milestones={upcoming.milestones}
      />
      {items.length === 0 ? (
        <Empty>
          No deliverables or milestones in the next 30 days. Projects are notes with{' '}
          <code>type: project</code> frontmatter.
        </Empty>
      ) : (
        <div className="home-list home-planner-list">
          {items.map((item) =>
            item.kind === 'deliverable' ? (
              <button
                key={item.id}
                className={`home-row${item.overdue ? ' home-row-overdue' : ''}`}
                onClick={() => open(item.path, item.line)}
              >
                <ProgressRing percent={item.percent} overdue={item.overdue} />
                <span className="home-row-main">
                  <span className="home-row-text">{item.label}</span>
                  <span className="home-row-sub">
                    {item.projectTitle}
                    {item.parentLabel && ` › ${item.parentLabel}`}
                  </span>
                </span>
                <span className="home-row-meta">
                  <span
                    className={`home-chip home-chip-${item.overdue ? 'overdue' : item.start > today ? 'later' : 'soon'}`}
                  >
                    {item.overdue
                      ? `ended ${formatTimeUntil(item.end, today)}`
                      : item.start > today
                        ? `starts ${formatTimeUntil(item.start, today)}`
                        : `ends ${formatTimeUntil(item.end, today)}`}
                  </span>
                </span>
              </button>
            ) : (
              <button key={item.id} className="home-row" onClick={() => open(item.path, item.line)}>
                <span className={`home-diamond${item.important ? ' important' : ''}`} />
                <span className="home-row-main">
                  <span className="home-row-text">{item.label}</span>
                  <span className="home-row-sub">{item.projectTitle} · milestone</span>
                </span>
                <span className="home-row-meta">
                  <span
                    className={`home-chip home-chip-${item.date === today ? 'today' : 'later'}`}
                  >
                    {formatTimeUntil(item.date, today)}
                  </span>
                </span>
              </button>
            )
          )}
        </div>
      )}
    </Card>
  )
}

// ---------- Page ----------

export function HomeApp(): JSX.Element {
  const today = useToday()
  const notes = useIndexStore((s) => s.notes)
  const config = useConfigStore((s) => s.vaultConfig)
  const mountNames = useMountsStore((s) => s.mountNames)
  const inProgress = useMemo(
    () => inProgressCards(notes, config, mountNames),
    [notes, config, mountNames]
  )

  return (
    <div className="home">
      <Hero today={today} />
      <div className="home-grid">
        <PreviousDayCard today={today} />
        <InProgressCard
          cards={inProgress}
          today={today}
          hasColumn={inProgressColumn(config.columns) !== -1}
        />
        <DueCard today={today} />
        <PlannerCard today={today} />
      </div>
    </div>
  )
}
