/**
 * ExamMode's log file: what went wrong, for whoever has to find out why afterwards (a lab computer that stayed
 * locked, a hand-in the teacher's laptop couldn't keep). One line each; the file has a size, and the one before it
 * is kept. Nothing of an exam's content goes in it (N-09): where, what, and the error.
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export type Log = (where: string, what: string, error?: unknown) => void;
export const MAX_LOG_BYTES = 1024 * 1024;

const said = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}${(error as NodeJS.ErrnoException).code ? ` (${(error as NodeJS.ErrnoException).code})` : ''}` : String(error)).replace(/\s+/g, ' ').slice(0, 500);

/** A log that writes to `file`. It never throws: a log that can't be written isn't worth an exam. */
export function fileLog(file: string, now: () => Date = () => new Date(), maxBytes = MAX_LOG_BYTES): Log {
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    // (it will fail again below, quietly)
  }
  return (where, what, error) => {
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > maxBytes) renameSync(file, `${file}.1`);
    } catch {
      // the old one stays where it is
    }
    try {
      appendFileSync(file, `${now().toISOString()} ${where}: ${what.replace(/\s+/g, ' ').slice(0, 500)}${error === undefined ? '' : ` — ${said(error)}`}\n`);
    } catch {
      // nowhere to say it
    }
  };
}
