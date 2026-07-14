import { describe, expect, it } from 'vitest'
import { parseNote } from '@shared/parser/parseNote'

describe('parseNote', () => {
  it('extracts the title from the path', () => {
    const meta = parseNote('folder/My Note.md', '')
    expect(meta.title).toBe('My Note')
    expect(meta.path).toBe('folder/My Note.md')
  })

  it('parses frontmatter tags and aliases', () => {
    const meta = parseNote(
      'a.md',
      '---\ntags: [project, work/deep]\naliases:\n  - Alt Name\ncreated: 2026-07-01\n---\n\nBody.\n'
    )
    expect(meta.tags.map((t) => t.tag)).toEqual(['project', 'work/deep'])
    expect(meta.aliases).toEqual(['Alt Name'])
    expect(meta.frontmatter.created).toBeTruthy()
    expect(meta.frontmatterError).toBe(false)
  })

  it('tolerates malformed YAML without crashing', () => {
    const meta = parseNote('a.md', '---\n: : : bad [yaml\n---\n\nBody\n')
    expect(meta.frontmatterError).toBe(true)
    expect(meta.frontmatter).toEqual({})
  })

  it('extracts headings with levels and lines', () => {
    const meta = parseNote('a.md', '# One\n\ntext\n\n## Two\n')
    expect(meta.headings).toEqual([
      { text: 'One', level: 1, line: 0 },
      { text: 'Two', level: 2, line: 4 }
    ])
  })

  it('extracts wiki links with heading, alias, and embed forms', () => {
    const content = 'See [[Other Note]] and [[N#Head|shown]] plus ![[Pic.png]].\n'
    const meta = parseNote('a.md', content)
    expect(meta.links).toHaveLength(3)
    expect(meta.links[0]).toMatchObject({ target: 'Other Note', embed: false, line: 0 })
    expect(meta.links[1]).toMatchObject({ target: 'N', heading: 'Head', alias: 'shown' })
    expect(meta.links[2]).toMatchObject({ target: 'Pic.png', embed: true })
    expect(meta.links[0].context).toContain('[[Other Note]]')
  })

  it('ignores links and tags inside code blocks and inline code', () => {
    const content =
      'Real [[Link]] and #real\n\n```\n[[NotALink]] #nottag\n```\n\nAnd `[[inline#no]]` end.\n'
    const meta = parseNote('a.md', content)
    expect(meta.links.map((l) => l.target)).toEqual(['Link'])
    expect(meta.tags.map((t) => t.tag)).toEqual(['real'])
  })

  it('extracts body tags but not headings or pure numbers', () => {
    const meta = parseNote('a.md', '# Heading\n\n#tag1 word #nested/tag #123 not#this\n')
    expect(meta.tags.map((t) => t.tag)).toEqual(['tag1', 'nested/tag'])
  })

  it('extracts tasks with custom status chars and nesting', () => {
    const content = '- [ ] open\n- [x] done\n- [/] doing #urgent\n  - [ ] child\n1. [ ] numbered\n'
    const meta = parseNote('a.md', content)
    expect(meta.tasks).toHaveLength(5)
    expect(meta.tasks[0]).toMatchObject({
      statusChar: ' ',
      text: 'open',
      line: 0,
      indent: 0,
      isSubtask: false
    })
    expect(meta.tasks[1]).toMatchObject({ statusChar: 'x', text: 'done', isSubtask: false })
    expect(meta.tasks[2]).toMatchObject({ statusChar: '/', tags: ['urgent'], isSubtask: false })
    expect(meta.tasks[3]).toMatchObject({ indent: 2, text: 'child', isSubtask: true })
    expect(meta.tasks[4]).toMatchObject({ text: 'numbered', isSubtask: false })
    expect(meta.tasks[2].rawLine).toBe('- [/] doing #urgent')
  })

  it('marks tasks nested under a shallower task as subtasks, resetting after dedent', () => {
    const content =
      '- [ ] task A\n  - [ ] subtask A1\n  - [ ] subtask A2\n- [ ] task B\n  - [ ] subtask B1\n'
    const meta = parseNote('a.md', content)
    expect(meta.tasks.map((t) => t.isSubtask)).toEqual([false, true, true, false, true])
  })

  it('preserves rawLine for CRLF content without the \\r', () => {
    const meta = parseNote('a.md', '- [ ] one\r\n- [x] two\r\n')
    expect(meta.tasks[0].rawLine).toBe('- [ ] one')
    expect(meta.tasks[1].rawLine).toBe('- [x] two')
    expect(meta.tasks[1].line).toBe(1)
  })

  it('does not treat checkbox-looking lines inside fences as tasks', () => {
    const meta = parseNote('a.md', '```\n- [ ] fake\n```\n\n- [ ] real\n')
    expect(meta.tasks).toHaveLength(1)
    expect(meta.tasks[0].text).toBe('real')
  })

  it('handles unicode task text', () => {
    const meta = parseNote('a.md', '- [ ] émojis 🎉 und Ümlaute\n')
    expect(meta.tasks[0].text).toBe('émojis 🎉 und Ümlaute')
  })

  it('extracts 🚜 machine log entries with serial, text, tags, and date', () => {
    const meta = parseNote('a.md', '🚜 Z6A00101 Replaced final drive #maintenance 📅 2026-07-03\n')
    expect(meta.machineLog).toHaveLength(1)
    expect(meta.machineLog[0]).toMatchObject({
      serial: 'Z6A00101',
      text: 'Replaced final drive #maintenance 📅 2026-07-03',
      tags: ['maintenance'],
      line: 0
    })
  })

  it('does not surface 🚜 lines as tasks or milestones', () => {
    const meta = parseNote('a.md', '🚜 Z6A00101 did work 📅 2026-07-03\n')
    expect(meta.tasks).toHaveLength(0)
    expect(meta.milestones).toHaveLength(0)
    expect(meta.machineLog).toHaveLength(1)
  })

  it('ignores 🚜 lines inside code fences', () => {
    const meta = parseNote('a.md', '```\n🚜 Z6A00101 fake 📅 2026-07-03\n```\n')
    expect(meta.machineLog).toHaveLength(0)
  })

  it('extracts 🏁 milestones with tags, excluded from tasks', () => {
    const meta = parseNote('a.md', '🏁 Ship v1 #release\n- [ ] real task\n')
    expect(meta.milestones).toHaveLength(1)
    expect(meta.milestones[0]).toMatchObject({
      text: 'Ship v1 #release',
      tags: ['release'],
      line: 0,
      rawLine: '🏁 Ship v1 #release'
    })
    expect(meta.tasks).toHaveLength(1)
  })

  it('attaches an indented Reason line to the task above it', () => {
    const content =
      '- [w] waiting task\n  Reason for Waiting: parts on order 📅 2026-07-02\n- [ ] other\n'
    const meta = parseNote('a.md', content)
    expect(meta.tasks[0]).toMatchObject({
      waitingReason: 'parts on order',
      waitingSince: '2026-07-02'
    })
    expect(meta.tasks[1]).toMatchObject({ waitingReason: null, waitingSince: null })
  })

  it('does not attach a Reason line indented at or below the task level', () => {
    const meta = parseNote(
      'a.md',
      '  - [w] nested task\n  Reason for Waiting: nope 📅 2026-07-02\n'
    )
    expect(meta.tasks[0]).toMatchObject({ waitingReason: null, waitingSince: null })
  })

  it('extracts Status Changed and Date Entered dates from a task note block', () => {
    const content =
      '- [/] task\n  - Status Changed: 7/13/2026\n  - Date Entered: 7/1/2026\n  - Notes: hi\n'
    const meta = parseNote('a.md', content)
    expect(meta.tasks[0]).toMatchObject({ statusChanged: '7/13/2026', dateEntered: '7/1/2026' })
  })

  it('treats an unset Status Changed (n/a) as null', () => {
    const content = '- [ ] task\n  - Status Changed: n/a\n  - Date Entered: 7/1/2026\n'
    const meta = parseNote('a.md', content)
    expect(meta.tasks[0]).toMatchObject({ statusChanged: null, dateEntered: '7/1/2026' })
  })

  it('finds Status Changed / Date Entered past a blank line and a Reason line', () => {
    const content =
      '- [w] task\n  Reason for Waiting: parts 📅 2026-07-02\n\n  - Status Changed: 7/2/2026\n  - Date Entered: 6/30/2026\n'
    const meta = parseNote('a.md', content)
    expect(meta.tasks[0]).toMatchObject({ statusChanged: '7/2/2026', dateEntered: '6/30/2026' })
  })

  it('leaves Status Changed / Date Entered null when a task has no note block', () => {
    const meta = parseNote('a.md', '- [ ] plain task\n- [ ] another\n')
    expect(meta.tasks[0]).toMatchObject({ statusChanged: null, dateEntered: null })
  })

  it('extracts ^block-id anchors with their lines', () => {
    const content = 'Intro paragraph. ^intro\n\n- [ ] a task ^task-1\nplain line\n'
    const meta = parseNote('a.md', content)
    expect(meta.blockIds).toEqual([
      { id: 'intro', line: 0 },
      { id: 'task-1', line: 2 }
    ])
  })

  it('ignores ^ids inside code fences and mid-line carets', () => {
    const content = '```\ncode ^notablock\n```\n\n2^10 is 1024\nreal ^yes\n'
    const meta = parseNote('a.md', content)
    expect(meta.blockIds).toEqual([{ id: 'yes', line: 5 }])
  })

  it('parses [[Note#^id]] links with the block ref in the heading slot', () => {
    const meta = parseNote('a.md', 'See [[Other#^intro]] for context.\n')
    expect(meta.links[0]).toMatchObject({ target: 'Other', heading: '^intro' })
  })

  it('parses a rich combined note consistently', () => {
    const content = [
      '---',
      'tags: [project]',
      'aliases: Alt',
      '---',
      '',
      '# Plan',
      '',
      'Intro with [[Other#Sec|see]] and #body/tag.',
      '',
      '- [ ] top task #a',
      '  - [/] child task',
      '🏁 Milestone here #m',
      '🚜 SN123 greased fittings #maint',
      '',
      '```',
      '- [ ] not a task #nottag [[NotLink]]',
      '```',
      ''
    ].join('\n')
    const meta = parseNote('n.md', content)
    // Frontmatter tags plus every body tag, including those on task/milestone/log lines
    expect(meta.tags.map((t) => t.tag).sort()).toEqual(
      ['project', 'body/tag', 'a', 'm', 'maint'].sort()
    )
    expect(meta.aliases).toEqual(['Alt'])
    expect(meta.headings).toEqual([{ text: 'Plan', level: 1, line: 5 }])
    expect(meta.links).toHaveLength(1)
    expect(meta.links[0]).toMatchObject({ target: 'Other', heading: 'Sec', alias: 'see' })
    expect(meta.tasks.map((t) => t.text)).toEqual(['top task #a', 'child task'])
    expect(meta.tasks[1].isSubtask).toBe(true)
    expect(meta.milestones).toHaveLength(1)
    expect(meta.machineLog).toHaveLength(1)
  })
})
