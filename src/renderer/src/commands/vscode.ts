/**
 * Open the current vault as a VS Code workspace, creating a blank
 * `.code-workspace` file for it first if one doesn't exist yet.
 */
export async function openInVSCode(): Promise<void> {
  const err = await window.knote.openInVSCode()
  if (err) alert(`Couldn't open VS Code: ${err}`)
}
