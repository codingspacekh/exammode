/**
 * Who signs teacher licences (architecture §2.12). These are build settings, in `author.json`: the author's public
 * keys (`npm run licence -- init` writes the first), the numbers of the licences taken back, and the address a
 * teacher's request is emailed to. Someone who runs their own ExamMode sets their own, and their licences work
 * only in their own builds.
 */
import settings from './author.json';
import type { Trust } from './licence';

export const AUTHOR: string = settings.author;
export const AUTHOR_KEYS: string[] = settings.keys;
export const WITHDRAWN: string[] = settings.withdrawn;
/** Where a teacher's request goes by email; empty: the teacher is told to send it to the author. */
export const REQUEST_ADDRESS: string = settings.requestAddress;

/** What an ExamMode believes. An installed one: the author's licences, nothing else. A development build may be
 *  given more author keys (a test's own author) and takes a teacher with no licence unless told not to. */
export function trustOf(installed: boolean, extraKeys: string[] = [], requireLicence = false): Trust {
  return installed
    ? { authorKeys: AUTHOR_KEYS, withdrawn: WITHDRAWN }
    : { authorKeys: [...AUTHOR_KEYS, ...extraKeys], withdrawn: WITHDRAWN, allowUnsigned: !requireLicence };
}
