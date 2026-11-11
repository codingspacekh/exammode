/**
 * The keys the low-level keyboard hook swallows (F-14, architecture §2.5). Everything else passes through.
 * Ctrl+Alt+Del can't be hooked: the policies of the lockdown plan empty its screen. Alt+Tab is left alone: every
 * window it could reach is an allowed one. To block another shortcut, add it here with its test.
 */

export const VK = { TAB: 0x09, ESCAPE: 0x1b, SPACE: 0x20, LWIN: 0x5b, RWIN: 0x5c, F4: 0x73 } as const;

export interface KeyPress {
  /** the virtual-key code */
  vk: number;
  ctrl: boolean;
  alt: boolean;
  /** the exam bar is the window in front */
  onBar: boolean;
}

export function swallow(key: KeyPress): boolean {
  // the Windows keys: Start, and with them Win+R, Win+E, Win+D, Win+V, Win+Tab …
  if (key.vk === VK.LWIN || key.vk === VK.RWIN) return true;
  // Ctrl+Esc (Start), Ctrl+Shift+Esc (Task Manager), Alt+Esc (the next window, allowed or not)
  if (key.vk === VK.ESCAPE) return key.ctrl || key.alt;
  // Alt+Space on the bar: its window menu (Move, Close)
  return key.vk === VK.SPACE && key.alt && key.onBar;
}
