/**
 * Locking the lab computer for an exam, as the student's flow sees it (architecture §2.4): the checks, the lock
 * and the unlock. On a lab computer this is Windows and the Guard (lockdown-win.ts); in the tests, a fake; with no
 * lockdown at all (a Mac, a development build) an exam runs unlocked, as in M3.
 */
import type { AppToClose, Check } from '@lib/lockdown/checks';

export interface Checked { checks: Check[]; ok: boolean; toClose: AppToClose[] }

/** What the lock needs to know about the exam. */
export interface LockInfo { runId: string; teacher: { host: string; port: number }; websites: boolean; token: string; instanceId: string; pc: string }

export interface Lockdown {
  /** The computer's checks (02). Changes nothing. */
  check(): Promise<Checked>;
  /** Closes the apps that aren't part of the exam, empties the clipboard and locks. `onClosed`: an app was closed
   *  during the exam (07). Answers with what went wrong, in words, if the computer couldn't be locked. */
  lock(info: LockInfo, onClosed: (app: { name: string; kind: string }) => void): Promise<string | undefined>;
  /** Puts the computer back as it was (F-21). */
  unlock(): Promise<void>;
}
