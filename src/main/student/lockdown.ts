/**
 * Locking the lab computer for an exam, as the student's flow sees it (architecture §2.4): the checks, the lock
 * and the unlock. On a lab computer this is Windows and the Guard (lockdown-win.ts); in the tests, a fake; with no
 * lockdown at all (a Mac, a development build) an exam runs unlocked, as in M3.
 */
import type { AppToClose, Check } from '@lib/lockdown/checks';
import type { AppProfile } from '@lib/profiles/schema';

export interface Checked { checks: Check[]; ok: boolean; toClose: AppToClose[] }

/** What the lock needs to know about the exam. */
export interface LockInfo {
  runId: string; teacher: { host: string; port: number }; websites: boolean; token: string; instanceId: string; pc: string;
  /** the exam's apps: they may stay, and the exam bar can start them (F-11, F-12) */
  apps: AppProfile[];
  /** the student's Exam folder: where the apps are started */
  examFolder: string;
}

/** One of the exam's apps that is open now. */
export interface OpenApp { id: string; /** its window is the one in front */ front: boolean; /** that window's title */ title?: string }

/** What the lock tells the flow while the exam runs. */
export interface LockEvents {
  /** an app that isn't part of the exam was closed (07) */
  closed(app: { name: string; kind: string }): void;
  /** which of the exam's apps are open, whenever that changes */
  apps(open: OpenApp[]): void;
}

export interface Lockdown {
  /** The computer's checks (02). Changes nothing. */
  check(): Promise<Checked>;
  /** Closes the apps that aren't part of the exam, empties the clipboard and locks. Answers with what went
   *  wrong, in words, if the computer couldn't be locked. */
  lock(info: LockInfo, events: LockEvents): Promise<string | undefined>;
  /** Opens one of the exam's apps in the Exam folder, under the bar — or brings it to the front if it is open
   *  (F-11). Answers `notInstalled` or `failed` if it couldn't. */
  openApp(id: string): Promise<'notInstalled' | 'failed' | undefined>;
  /** Puts the computer back as it was (F-21). */
  unlock(): Promise<void>;
}
