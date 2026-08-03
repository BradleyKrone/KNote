import { describe, expect, it } from 'vitest'
import {
  buildPlannerModel,
  cascadeShift,
  childFolders,
  notesInFolder,
  vaultFolders,
  violatedDependencies,
  wouldCycle
} from '@/planner/plannerSelectors'
import {
  closedDeliverableTags,
  deliverableWindows,
  visibleForDeliverable
} from '@shared/deliverables'
import { parseNote } from '@shared/parser/parseNote'
import type { NoteMeta } from '@shared/types'

const PROJECT = [
  '---',
  'type: project',
  'project: govalle',
  '---',
  '',
  '- [ ] Contracts 🛫 2026-03-20 📅 2026-04-05 #deliverable/govalle/contracts',
  '    - [x] Proposals #deliverable/govalle/contracts',
  '    - [ ] Bid date #deliverable/govalle/contracts',
  '- [ ] Design 🛫 2026-04-01 📅 2026-04-20 #deliverable/govalle/design ⛓ #deliverable/govalle/contracts',
  '- [ ] Procurement 🛫 2026-04-21 📅 2026-05-10 #deliverable/govalle/procurement ⛓ #deliverable/govalle/design',
  '🏁 Permits approved 📅 2026-04-12 #deliverable/govalle/design',
  '🏁 Groundbreaking !! 📅 2026-05-01',
  ''
].join('\n')

function vault(extra: Record<string, string> = {}): Map<string, NoteMeta> {
  const notes = new Map<string, NoteMeta>()
  notes.set('Govalle.md', parseNote('Govalle.md', PROJECT))
  for (const [path, content] of Object.entries(extra)) notes.set(path, parseNote(path, content))
  return notes
}

describe('buildPlannerModel', () => {
  it('reads projects and their deliverable spans', () => {
    const { projects, byId } = buildPlannerModel(vault())
    expect(projects).toHaveLength(1)
    expect(projects[0].slug).toBe('govalle')
    expect([...byId.keys()]).toEqual([
      'deliverable/govalle/contracts',
      'deliverable/govalle/design',
      'deliverable/govalle/procurement'
    ])
    const contracts = byId.get('deliverable/govalle/contracts')!
    expect(contracts.start).toBe('2026-03-20')
    expect(contracts.end).toBe('2026-04-05')
    expect(contracts.label).toBe('Contracts')
    // The project spans its earliest start to its latest end.
    expect(projects[0].start).toBe('2026-03-20')
    expect(projects[0].end).toBe('2026-05-10')
  })

  it('falls back to the end date when a deliverable has no 🛫 start', () => {
    const notes = vault()
    notes.set(
      'P.md',
      parseNote(
        'P.md',
        '---\ntype: project\nproject: p\n---\n- [ ] One 📅 2026-06-01 #deliverable/p/one\n'
      )
    )
    const d = buildPlannerModel(notes).byId.get('deliverable/p/one')!
    expect(d.start).toBe('2026-06-01')
    expect(d.end).toBe('2026-06-01')
  })

  it('adopts tasks tagged from any other note in the vault', () => {
    const notes = vault({
      'Field notes.md': '- [ ] Order rebar #deliverable/govalle/procurement 📅 2026-04-25\n'
    })
    const procurement = buildPlannerModel(notes).byId.get('deliverable/govalle/procurement')!
    expect(procurement.tasks).toHaveLength(1)
    expect(procurement.tasks[0].text).toBe('Order rebar')
    expect(procurement.tasks[0].foreign).toBe(true)
    expect(procurement.tasks[0].due).toBe('2026-04-25')
  })

  it('never counts a deliverable line as one of its own member tasks', () => {
    const contracts = buildPlannerModel(vault()).byId.get('deliverable/govalle/contracts')!
    expect(contracts.tasks.map((t) => t.text)).toEqual(['Bid date', 'Proposals'])
  })

  it('ignores tags that are not exactly three segments', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'P.md',
      parseNote(
        'P.md',
        [
          '---',
          'type: project',
          'project: p',
          '---',
          '- [ ] Two segments 📅 2026-06-01 #deliverable/p',
          '- [ ] Four segments 📅 2026-06-02 #deliverable/p/a/b',
          ''
        ].join('\n')
      )
    )
    expect(buildPlannerModel(notes).byId.size).toBe(0)
  })

  it('ignores a deliverable-shaped task in a note that is not a project', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'N.md',
      parseNote('N.md', '- [ ] Fake 🛫 2026-01-01 📅 2026-02-01 #deliverable/x/y\n')
    )
    expect(buildPlannerModel(notes).byId.size).toBe(0)
  })

  it('computes percent complete from member tasks, and from its own checkbox when it has none', () => {
    const model = buildPlannerModel(vault())
    expect(model.byId.get('deliverable/govalle/contracts')!.percent).toBe(50) // 1 of 2
    expect(model.byId.get('deliverable/govalle/design')!.percent).toBe(0) // unchecked, no tasks
  })

  it('places milestones on their deliverable, and unowned ones on the project', () => {
    const { projects, byId } = buildPlannerModel(vault())
    expect(byId.get('deliverable/govalle/design')!.milestones.map((m) => m.text)).toEqual([
      'Permits approved'
    ])
    expect(projects[0].milestones.map((m) => m.text)).toEqual(['Groundbreaking'])
    expect(projects[0].milestones[0].important).toBe(true)
  })

  it('builds dependency edges predecessor → dependent, dropping unknown targets', () => {
    const model = buildPlannerModel(vault())
    expect(model.dependents.get('deliverable/govalle/contracts')).toEqual([
      'deliverable/govalle/design'
    ])
    expect(model.byId.get('deliverable/govalle/design')!.dependsOn).toEqual([
      'deliverable/govalle/contracts'
    ])
    expect(model.dependents.has('deliverable/govalle/nope')).toBe(false)
  })

  it('reads several ⛓ markers on one line', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'P.md',
      parseNote(
        'P.md',
        [
          '---',
          'type: project',
          'project: p',
          '---',
          '- [ ] A 📅 2026-06-01 #deliverable/p/a',
          '- [ ] B 📅 2026-06-02 #deliverable/p/b',
          '- [ ] C 📅 2026-06-03 #deliverable/p/c ⛓ #deliverable/p/a ⛓ #deliverable/p/b',
          ''
        ].join('\n')
      )
    )
    expect(buildPlannerModel(notes).byId.get('deliverable/p/c')!.dependsOn).toEqual([
      'deliverable/p/a',
      'deliverable/p/b'
    ])
  })
})

describe('cascadeShift', () => {
  it('moves the dragged deliverable and everything transitively downstream', () => {
    const model = buildPlannerModel(vault())
    expect(cascadeShift(model, 'deliverable/govalle/contracts', 3)).toEqual([
      'deliverable/govalle/contracts',
      'deliverable/govalle/design',
      'deliverable/govalle/procurement'
    ])
  })

  it('never moves what the dragged deliverable depends on', () => {
    const model = buildPlannerModel(vault())
    expect(cascadeShift(model, 'deliverable/govalle/design', 3)).toEqual([
      'deliverable/govalle/design',
      'deliverable/govalle/procurement'
    ])
  })

  it('moves a diamond-shaped dependent exactly once', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'P.md',
      parseNote(
        'P.md',
        [
          '---',
          'type: project',
          'project: p',
          '---',
          '- [ ] A 📅 2026-06-01 #deliverable/p/a',
          '- [ ] B 📅 2026-06-02 #deliverable/p/b ⛓ #deliverable/p/a',
          '- [ ] C 📅 2026-06-03 #deliverable/p/c ⛓ #deliverable/p/a',
          '- [ ] D 📅 2026-06-04 #deliverable/p/d ⛓ #deliverable/p/b ⛓ #deliverable/p/c',
          ''
        ].join('\n')
      )
    )
    const order = cascadeShift(buildPlannerModel(notes), 'deliverable/p/a', 2)
    expect(order.filter((id) => id === 'deliverable/p/d')).toHaveLength(1)
    expect(order).toHaveLength(4)
    // D must come after both of its predecessors.
    expect(order.indexOf('deliverable/p/d')).toBeGreaterThan(order.indexOf('deliverable/p/b'))
    expect(order.indexOf('deliverable/p/d')).toBeGreaterThan(order.indexOf('deliverable/p/c'))
  })

  it('shifts nothing but the dragged bar when the delta is zero', () => {
    const model = buildPlannerModel(vault())
    expect(cascadeShift(model, 'deliverable/govalle/contracts', 0)).toEqual([
      'deliverable/govalle/contracts'
    ])
  })
})

describe('wouldCycle / violatedDependencies', () => {
  it('refuses a link that would close a loop', () => {
    const model = buildPlannerModel(vault())
    // procurement already depends (transitively) on contracts.
    expect(
      wouldCycle(model, 'deliverable/govalle/procurement', 'deliverable/govalle/contracts')
    ).toBe(true)
    expect(
      wouldCycle(model, 'deliverable/govalle/contracts', 'deliverable/govalle/procurement')
    ).toBe(false)
    expect(wouldCycle(model, 'deliverable/govalle/design', 'deliverable/govalle/design')).toBe(true)
  })

  it('flags a deliverable that starts before its predecessor finishes', () => {
    const violations = violatedDependencies(buildPlannerModel(vault()))
    // Design starts 04-01 but Contracts runs to 04-05.
    expect([...violations]).toEqual(['deliverable/govalle/design'])
  })
})

describe('deliverableWindows / visibleForDeliverable', () => {
  const windows = deliverableWindows(vault())

  const task = (statusChar: string, ...tags: string[]): { statusChar: string; tags: string[] } => ({
    statusChar,
    tags
  })

  it('collects a window per deliverable', () => {
    expect(windows.get('deliverable/govalle/design')).toEqual({
      start: '2026-04-01',
      end: '2026-04-20'
    })
  })

  it('leaves untagged tasks alone', () => {
    expect(visibleForDeliverable(task(' '), windows, '2026-01-01')).toBe(true)
  })

  it('shows a task whose deliverable window contains today, and hides it before', () => {
    const t = task(' ', 'deliverable/govalle/design')
    expect(visibleForDeliverable(t, windows, '2026-04-10')).toBe(true)
    expect(visibleForDeliverable(t, windows, '2026-04-01')).toBe(true) // inclusive
    expect(visibleForDeliverable(t, windows, '2026-04-20')).toBe(true) // inclusive
    expect(visibleForDeliverable(t, windows, '2026-03-31')).toBe(false)
  })

  it('keeps an overdue unchecked task visible, but hides a finished one', () => {
    expect(
      visibleForDeliverable(task(' ', 'deliverable/govalle/design'), windows, '2026-06-01')
    ).toBe(true)
    expect(
      visibleForDeliverable(task('x', 'deliverable/govalle/design'), windows, '2026-06-01')
    ).toBe(false)
    expect(
      visibleForDeliverable(task('a', 'deliverable/govalle/design'), windows, '2026-06-01')
    ).toBe(false)
  })

  it('shows a task tagged for a deliverable that does not exist, rather than hiding work', () => {
    expect(visibleForDeliverable(task(' ', 'deliverable/ghost/thing'), windows, '2026-01-01')).toBe(
      true
    )
  })

  it('shows a task if any one of its deliverables is current', () => {
    const t = task(' ', 'deliverable/govalle/design', 'deliverable/govalle/procurement')
    expect(visibleForDeliverable(t, windows, '2026-05-05')).toBe(true)
  })
})

// A project can declare its own target end date and be closed off; both change
// what the planner lets you do with it.
describe('project status', () => {
  const project = (frontmatter: string[], deliverables: string[] = []): Map<string, NoteMeta> => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'P.md',
      parseNote(
        'P.md',
        ['---', 'type: project', 'project: p', ...frontmatter, '---', ...deliverables, ''].join(
          '\n'
        )
      )
    )
    return notes
  }
  const OPEN = ['- [ ] A 🛫 2026-01-01 📅 2026-02-01 #deliverable/p/a']
  const DONE = ['- [x] A 🛫 2026-01-01 📅 2026-02-01 #deliverable/p/a']

  const statusOf = (notes: Map<string, NoteMeta>, now: string): string =>
    buildPlannerModel(notes, now).projects[0].status

  it('is active with no end date, however old the work is', () => {
    expect(statusOf(project([], OPEN), '2030-01-01')).toBe('active')
  })

  it('is overdue past its declared end date with work still open', () => {
    expect(statusOf(project(['end: 2026-06-30'], OPEN), '2026-07-01')).toBe('overdue')
    expect(statusOf(project(['end: 2026-06-30'], OPEN), '2026-06-30')).toBe('active')
  })

  it('is not overdue once everything is done, however late', () => {
    expect(statusOf(project(['end: 2026-06-30'], DONE), '2030-01-01')).toBe('active')
  })

  it('reads due:/deadline: as the end date too', () => {
    expect(buildPlannerModel(project(['due: 2026-05-01'], OPEN)).projects[0].dueDate).toBe(
      '2026-05-01'
    )
  })

  it('is complete when declared, overriding overdue', () => {
    const notes = project(['end: 2026-06-30', 'status: completed'], OPEN)
    const p = buildPlannerModel(notes, '2030-01-01').projects[0]
    expect(p.status).toBe('complete')
    expect(p.complete).toBe(true)
  })

  it('accepts the obvious synonyms for completed', () => {
    for (const value of ['completed', 'complete', 'Done', 'FINISHED']) {
      expect(buildPlannerModel(project([`status: ${value}`], OPEN)).projects[0].complete).toBe(true)
    }
    expect(buildPlannerModel(project(['status: active'], OPEN)).projects[0].complete).toBe(false)
  })

  it('sorts completed projects below live ones', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set('A.md', parseNote('A.md', '---\ntype: project\nproject: a\nstatus: completed\n---\n'))
    notes.set('Z.md', parseNote('Z.md', '---\ntype: project\nproject: z\n---\n'))
    expect(buildPlannerModel(notes).projects.map((p) => p.slug)).toEqual(['z', 'a'])
  })
})

describe('closedDeliverableTags', () => {
  it('collects the deliverable tags of completed projects only', () => {
    const notes = new Map<string, NoteMeta>()
    notes.set(
      'Old.md',
      parseNote(
        'Old.md',
        '---\ntype: project\nproject: old\nstatus: completed\n---\n- [ ] A 📅 2026-02-01 #deliverable/old/a\n'
      )
    )
    notes.set(
      'New.md',
      parseNote(
        'New.md',
        '---\ntype: project\nproject: new\n---\n- [ ] B 📅 2026-02-01 #deliverable/new/b\n'
      )
    )
    const closed = closedDeliverableTags(notes)
    expect([...closed]).toEqual(['deliverable/old/a'])
  })

  it('is empty for a vault with no completed projects', () => {
    expect(closedDeliverableTags(vault()).size).toBe(0)
  })
})

describe('vaultFolders', () => {
  it('lists every folder, including ones holding only subfolders', () => {
    expect(
      vaultFolders([
        'Root note.md',
        'Projects/Govalle.md',
        'Clients/Govalle/Notes.md',
        'Clients/Acme/Notes.md'
      ])
    ).toEqual(['Clients', 'Clients/Acme', 'Clients/Govalle', 'Projects'])
  })

  it('skips hidden folders and their contents', () => {
    expect(vaultFolders(['.knote/config.json', '.obsidian/app.json', 'Notes/a.md'])).toEqual([
      'Notes'
    ])
  })

  it('is empty for a flat vault', () => {
    expect(vaultFolders(['a.md', 'b.md'])).toEqual([])
  })
})

describe('childFolders / notesInFolder', () => {
  const folders = ['Clients', 'Clients/Acme', 'Clients/Govalle', 'Clients/Govalle/2026', 'Projects']
  const paths = ['Root.md', 'Clients/Index.md', 'Clients/Govalle/Notes.md', 'Projects/P.md']

  it('lists only the immediate children of a folder', () => {
    expect(childFolders(folders, '')).toEqual(['Clients', 'Projects'])
    expect(childFolders(folders, 'Clients')).toEqual(['Clients/Acme', 'Clients/Govalle'])
    expect(childFolders(folders, 'Clients/Govalle')).toEqual(['Clients/Govalle/2026'])
    expect(childFolders(folders, 'Clients/Govalle/2026')).toEqual([])
  })

  it('does not treat a name-prefix match as a child', () => {
    expect(childFolders(['Client', 'Clients/Acme'], 'Client')).toEqual([])
  })

  it('lists only the notes sitting directly in a folder', () => {
    expect(notesInFolder(paths, '')).toEqual(['Root.md'])
    expect(notesInFolder(paths, 'Clients')).toEqual(['Index.md'])
    expect(notesInFolder(paths, 'Clients/Govalle')).toEqual(['Notes.md'])
  })
})
