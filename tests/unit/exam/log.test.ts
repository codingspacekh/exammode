import { describe, expect, it } from 'vitest';
import { logCsv, stamp } from '@lib/exam/log';

const BOM = String.fromCharCode(0xfeff);
const at = new Date(2026, 10, 12, 9, 58, 12).getTime();

describe('F-42 export the log as a spreadsheet', () => {
  it('one row for each event: when, who, where, what, and its details', () => {
    const csv = logCsv([
      { at, kind: 'appClosed', student: 'Dara Kim', pc: 'PC-03', details: { app: 'Google Chrome' } },
      { at: at + 60_000, kind: 'runEnded', details: {} },
    ]);
    expect(csv).toBe(BOM + 'Time,Student,Computer,What happened,Details\r\n2026-11-12 09:58:12,Dara Kim,PC-03,appClosed,app: Google Chrome\r\n2026-11-12 09:59:12,,,runEnded,\r\n');
  });

  it('commas, quotes and line breaks stay inside their cell', () => {
    const csv = logCsv([{ at, kind: 'letBackIn', student: 'Sok, Vannak', details: { reason: 'He said "it crashed"\nand it had', localLog: [{ kind: 'contactLost' }] } }]);
    expect(csv.split('\r\n')[1]).toBe('2026-11-12 09:58:12,"Sok, Vannak",,letBackIn,"reason: He said ""it crashed""\nand it had; localLog: [{""kind"":""contactLost""}]"');
  });

  it('a name that starts like a formula is not one in the teacher\'s spreadsheet', () => {
    const csv = logCsv([{ at, kind: '@joined', student: '=HYPERLINK("http://evil.example")', pc: '+PC', details: {} }]);
    expect(csv.split('\r\n')[1]).toBe('2026-11-12 09:58:12,"\'=HYPERLINK(""http://evil.example"")",\'+PC,\'@joined,');
  });

  it('times are on a 24-hour clock with the date', () => {
    expect(stamp(new Date(2026, 0, 5, 7, 3, 9).getTime())).toBe('2026-01-05 07:03:09');
  });
});
