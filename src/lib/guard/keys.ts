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

/** The rules as data: the keyboard hook runs on a thread of its own and is given them (src/win/keyboard.ts). */
export const RULES = {
  // the Windows keys: Start, and with them Win+R, Win+E, Win+D, Win+V, Win+Tab …
  always: [VK.LWIN, VK.RWIN] as number[],
  // Ctrl+Esc (Start), Ctrl+Shift+Esc (Task Manager), Alt+Esc (the next window, allowed or not)
  withCtrlOrAlt: [VK.ESCAPE] as number[],
  // Alt+Space on the bar: its window menu (Move, Close)
  withAltOnBar: [VK.SPACE] as number[],
};
export type KeyRules = typeof RULES;

/** Is this key press swallowed, by these rules? It uses nothing but what it is given, so the hook's thread can
 *  run this very function. */
export function swallowBy(rules: KeyRules, key: KeyPress): boolean {
  if (rules.always.includes(key.vk)) return true;
  if (rules.withCtrlOrAlt.includes(key.vk)) return key.ctrl || key.alt;
  return rules.withAltOnBar.includes(key.vk) && key.alt && key.onBar;
}

export const swallow = (key: KeyPress): boolean => swallowBy(RULES, key);
