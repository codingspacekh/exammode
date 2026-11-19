import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileLog } from '@infrastructure/log';
import { tempFolder } from './helpers';

describe('the log file', () => {
  const at = () => new Date('2026-11-14T08:30:00Z');
  it('one line for what went wrong: when, where, what, and the error — on one line, and not too long', async () => {
    const file = join(await tempFolder(), 'logs', 'exammode.log');
    const log = fileLog(file, at);
    log('unlock', 'This computer couldn\'t be put back');
    log('upload', 'the files\ncouldn\'t be kept', Object.assign(new Error('no space left\non device'), { code: 'ENOSPC' }));
    log('main', 'x'.repeat(2000), 'a word');
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines[0]).toBe('2026-11-14T08:30:00.000Z unlock: This computer couldn\'t be put back');
    expect(lines[1]).toBe('2026-11-14T08:30:00.000Z upload: the files couldn\'t be kept — Error: no space left on device (ENOSPC)');
    expect(lines[2]!.length).toBeLessThan(600);
    expect(lines[2]).toMatch(/ — a word$/);
  });
  it('has a size: the file before it is kept, once', async () => {
    const file = join(await tempFolder(), 'exammode.log');
    writeFileSync(file, 'old\n'.repeat(50));
    const log = fileLog(file, at, 100);
    log('main', 'new');
    expect(readFileSync(`${file}.1`, 'utf8')).toMatch(/^old/);
    expect(readFileSync(file, 'utf8')).toBe('2026-11-14T08:30:00.000Z main: new\n');
  });
  it('a log that can\'t be written doesn\'t stop anything', async () => {
    const folder = await tempFolder();
    writeFileSync(join(folder, 'in-the-way'), '');
    expect(() => fileLog(join(folder, 'in-the-way', 'exammode.log'))('main', 'said to nobody')).not.toThrow();
  });
});
