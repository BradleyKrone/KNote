export interface Command {
  id: string
  name: string
  /** Display-only hotkey hint (e.g. "Ctrl+O") */
  hotkey?: string
  run: () => void | Promise<void>
}

const commands = new Map<string, Command>()

export function registerCommand(command: Command): void {
  commands.set(command.id, command)
}

export function allCommands(): Command[] {
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function runCommand(id: string): void {
  void commands.get(id)?.run()
}
