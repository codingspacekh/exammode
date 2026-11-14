/**
 * Export the log (F-42): every event of a run as a spreadsheet for the school's records — a CSV that Excel opens
 * as it is. Pure: the caller gives the events and writes the file.
 */

export interface LogLine { at: number; kind: string; student?: string; pc?: string; details: Record<string, unknown> }

/** A cell: quoted when it has a comma, a quote or a line break; a leading = + - @ is made harmless, so a
 *  student's file or app name can't become a formula in the teacher's spreadsheet. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** The mark that tells Excel a file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const two = (n: number): string => String(n).padStart(2, '0');
/** `2026-11-12 09:58:12`, on the teacher's laptop's clock. */
export function stamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** What an event's details say, in one cell: `app: Chrome; seconds: 45`. */
function words(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join('; ');
}

export function logCsv(lines: LogLine[]): string {
  const rows = lines.map((l) => [stamp(l.at), l.student ?? '', l.pc ?? '', l.kind, words(l.details)]);
  // the mark at the start tells Excel the file is UTF-8, so Khmer names stay Khmer
  return `${BOM}${[['Time', 'Student', 'Computer', 'What happened', 'Details'], ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
