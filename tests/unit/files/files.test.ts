import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { changed, nextSnapshot, toHash, type Snapshot } from '@lib/files/changes';
import { handInList } from '@lib/files/handIn';
import { receiptCode } from '@lib/files/receipt';
import { fromTeacher, PROTOCOL_VERSION } from '@lib/protocol/messages';

const sha = (content: string) => createHash('sha256').update(content).digest('hex');
const file = (name: string, content: string, modified = 1000) => ({ name, bytes: content.length, modified, sha256: sha(content) });
const stat = ({ name, bytes, modified }: { name: string; bytes: number; modified: number }) => ({ name, bytes, modified });

describe('F-22 changed files: size and time first, then the hash', () => {
  const last: Snapshot = { 'Report.docx': file('Report.docx', 'draft one'), 'data.xlsx': file('data.xlsx', 'numbers') };
  it('a file whose size and time are the same is not read again', () => {
    expect(toHash(last, Object.values(last).map(stat))).toEqual([]);
  });
  it('a new file, and one whose size or time changed, are hashed', () => {
    const now = [stat(file('Report.docx', 'draft one, longer', 2000)), stat(file('data.xlsx', 'numbers', 3000)), stat(file('notes.txt', 'new'))];
    expect(toHash(last, now).map((f) => f.name)).toEqual(['Report.docx', 'data.xlsx', 'notes.txt']);
  });
  it('only a file whose content changed, or a new one, goes to the teacher', () => {
    const hashed = [file('Report.docx', 'draft two', 2000), file('data.xlsx', 'numbers', 3000), file('notes.txt', 'new')];
    expect(changed(last, hashed).map((f) => f.name)).toEqual(['Report.docx', 'notes.txt']);
  });
  it('the next snapshot keeps what was not read, takes what was, and forgets a deleted file', () => {
    const touched = file('data.xlsx', 'numbers', 3000);
    const now = [stat(touched), stat(file('notes.txt', 'new'))];
    const next = nextSnapshot(last, now, [touched, file('notes.txt', 'new')]);
    expect(next).toEqual({ 'data.xlsx': touched, 'notes.txt': file('notes.txt', 'new') });
    // saved again without a change: not hashed a second time
    expect(toHash(next, now)).toEqual([]);
    expect(nextSnapshot(last, [stat(last['Report.docx']!)], [])).toEqual({ 'Report.docx': last['Report.docx'] });
  });
  it('a file seen for the first time but not hashed yet is not in the snapshot', () => {
    expect(nextSnapshot({}, [stat(file('big.mp4', 'still being written'))], [])).toEqual({});
  });
});

describe('F-16 the hand-in list', () => {
  const given = [file('Report.docx', 'the template'), file('data.xlsx', 'numbers')];
  it('F-16 made, changed, and given-and-unchanged files are listed apart', () => {
    const now = [file('Report.docx', 'my report'), file('data.xlsx', 'numbers', 5000), file('chart.png', 'a chart')];
    const list = handInList(given, now);
    expect(list.made.map((f) => f.name)).toEqual(['chart.png']);
    expect(list.changed.map((f) => f.name)).toEqual(['Report.docx']);
    expect(list.unchanged.map((f) => f.name)).toEqual(['data.xlsx']);
  });
  it('the files that go to the teacher are the made and the changed ones, by name', () => {
    const list = handInList(given, [file('z.txt', 'z'), file('Report.docx', 'my report'), file('a.txt', 'a'), file('data.xlsx', 'numbers')]);
    expect(list.send.map((f) => f.name)).toEqual(['a.txt', 'Report.docx', 'z.txt']);
  });
  it('nothing made or changed: nothing to send', () => {
    expect(handInList(given, given)).toMatchObject({ made: [], changed: [], send: [] });
    expect(handInList([], [])).toEqual({ made: [], changed: [], unchanged: [], send: [] });
  });
});

describe('F-16 the receipt', () => {
  const files = [file('Report.docx', 'my report'), file('chart.png', 'a chart')];
  it('F-16 the receipt is the same for the same files and different for one changed byte', async () => {
    const code = await receiptCode('r-1', 's-07', files);
    expect(await receiptCode('r-1', 's-07', files)).toBe(code);
    expect(await receiptCode('r-1', 's-07', [file('Report.docx', 'my reporT'), files[1]!])).not.toBe(code);
  });
  it('it is 6 characters shown as HX7-29Q, with none that are easily misread (0 O 1 I L)', async () => {
    const code = await receiptCode('r-1', 's-07', files);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);
    expect(fromTeacher.safeParse({ v: PROTOCOL_VERSION, type: 'receipt', code, files: [] }).success).toBe(true);
  });
  it('the order of the files does not matter; the run, the student and a file\'s name do', async () => {
    const code = await receiptCode('r-1', 's-07', files);
    expect(await receiptCode('r-1', 's-07', [...files].reverse())).toBe(code);
    expect(await receiptCode('r-2', 's-07', files)).not.toBe(code);
    expect(await receiptCode('r-1', 's-08', files)).not.toBe(code);
    expect(await receiptCode('r-1', 's-07', [{ ...files[0]!, name: 'Report2.docx' }, files[1]!])).not.toBe(code);
  });
  it('a hand-in with no files still has a receipt', async () => {
    expect(await receiptCode('r-1', 's-07', [])).toMatch(/^.{3}-.{3}$/);
  });
});
