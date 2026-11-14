import koffi from 'koffi';
import { describe, expect, it } from 'vitest';
import { RULES, VK } from '@lib/guard/keys';
import { KeyboardHook } from '../../src/win/keyboard';

/** M4's keyboard hook against real Windows (T7): key presses are made by Windows itself (keybd_event), and a
 *  second hook that only watches says which of them still get through. */
const windows = process.platform === 'win32';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CONTROL = 0x11;
const ALT = 0x12;
const F23 = 0x86;
const F24 = 0x87;

describe.runIf(windows)('F-14 the keyboard while locked', () => {
  it('the Windows key, Ctrl+Esc and Alt+Esc do nothing; everything else passes; afterwards the keys are back', async () => {
    const keybd_event = koffi.load('user32.dll').func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)');
    const tap = (vk: number) => { keybd_event(vk, 0, 0, 0); keybd_event(vk, 0, 2, 0); };
    const chord = (mod: number, vk: number) => { keybd_event(mod, 0, 0, 0); tap(vk); keybd_event(mod, 0, 2, 0); };

    // the watcher first, the blocker second: Windows asks the newest hook first
    const watcher = new KeyboardHook(RULES, false);
    await watcher.start();
    const blocker = new KeyboardHook();
    await blocker.start();
    await blocker.start();
    try {
      await wait(300);
      tap(F24);
      tap(VK.LWIN);
      tap(VK.RWIN);
      chord(CONTROL, VK.ESCAPE);
      chord(ALT, VK.ESCAPE);
      tap(VK.ESCAPE);
      chord(ALT, VK.TAB);
      tap(F23);
      await wait(500);
      // the blocker saw them all …
      expect([blocker.seen(VK.LWIN), blocker.seen(VK.RWIN), blocker.seen(VK.ESCAPE)]).toEqual([1, 1, 3]);
      // … and let through only what isn't a way out: Esc by itself, Alt+Tab, the F keys
      expect([watcher.seen(VK.LWIN), watcher.seen(VK.RWIN)]).toEqual([0, 0]);
      expect(watcher.seen(VK.ESCAPE)).toBe(1);
      expect([watcher.seen(F24), watcher.seen(F23), watcher.seen(VK.TAB)]).toEqual([1, 1, 1]);
      // each swallowed key going down and coming up: the two Windows keys, Esc twice
      expect(blocker.swallowed).toBe(8);

      await blocker.stop();
      await wait(300);
      tap(VK.RWIN);
      // (and Esc at once, so that the Start menu this opens is closed again)
      tap(VK.ESCAPE);
      await wait(500);
      expect(watcher.seen(VK.RWIN)).toBe(1);
    } finally {
      await blocker.stop();
      await watcher.stop();
    }
  }, 60_000);

  it('Alt+Space is swallowed only while the exam bar is the window in front', async () => {
    const user32 = koffi.load('user32.dll');
    const keybd_event = user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)');
    const front = BigInt(user32.func('uintptr __stdcall GetForegroundWindow()')() as number | bigint);
    const watcher = new KeyboardHook(RULES, false);
    await watcher.start();
    const blocker = new KeyboardHook();
    await blocker.start();
    const altSpace = async () => {
      keybd_event(ALT, 0, 0, 0); keybd_event(VK.SPACE, 0, 0, 0); keybd_event(VK.SPACE, 0, 2, 0); keybd_event(ALT, 0, 2, 0);
      await wait(300);
      // (a window menu that this opened is closed again)
      keybd_event(VK.ESCAPE, 0, 0, 0); keybd_event(VK.ESCAPE, 0, 2, 0);
      await wait(200);
    };
    try {
      await wait(300);
      // whatever is in front now stands in for the exam bar
      blocker.setBar(front);
      await altSpace();
      expect(watcher.seen(VK.SPACE)).toBe(0);
      blocker.setBar(1n);
      await altSpace();
      expect(watcher.seen(VK.SPACE)).toBe(1);
    } finally {
      await blocker.stop();
      await watcher.stop();
    }
  }, 60_000);
});
