import { describe, expect, it } from 'vitest';
import { VK, swallow } from '@lib/guard/keys';

const key = (vk: number, mods: { ctrl?: boolean; alt?: boolean; onBar?: boolean } = {}) => ({ vk, ctrl: false, alt: false, onBar: false, ...mods });

/** The keys the low-level keyboard hook swallows (architecture §2.5). */
describe('F-14 shortcuts out do nothing', () => {
  it('F-14 the Windows keys are swallowed, so Win+R, Win+E, Win+D and Win+V never happen', () => {
    expect(swallow(key(VK.LWIN))).toBe(true);
    expect(swallow(key(VK.RWIN))).toBe(true);
  });
  it('F-14 Ctrl+Esc (Start) and Ctrl+Shift+Esc (Task Manager) are swallowed', () => {
    expect(swallow(key(VK.ESCAPE, { ctrl: true }))).toBe(true);
  });
  it('F-14 Alt+Esc is swallowed', () => {
    expect(swallow(key(VK.ESCAPE, { alt: true }))).toBe(true);
  });
  it('Alt+Space is swallowed on the exam bar only: the bar has no window menu, apps keep theirs', () => {
    expect(swallow(key(VK.SPACE, { alt: true, onBar: true }))).toBe(true);
    expect(swallow(key(VK.SPACE, { alt: true }))).toBe(false);
    expect(swallow(key(VK.SPACE, { onBar: true }))).toBe(false);
  });
  it('everything else passes: Esc, typing, Ctrl+S, Alt+Tab, Alt+F4', () => {
    for (const k of [key(VK.ESCAPE), key(0x41), key(0x53, { ctrl: true }), key(VK.TAB, { alt: true }), key(VK.F4, { alt: true })]) {
      expect(swallow(k)).toBe(false);
    }
  });
});
