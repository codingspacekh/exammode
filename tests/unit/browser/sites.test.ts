import { describe, expect, it } from 'vitest';
import { allowsPage, decide, examSites, hostOf, parseSite } from '@lib/browser/sites';

describe('F-10 the exam\'s websites, as the teacher types them', () => {
  it('a whole site: docs.python.org/*', () => {
    expect(parseSite('docs.python.org/*')).toEqual({ host: 'docs.python.org', path: '', whole: true, start: 'https://docs.python.org/' });
    expect(parseSite(' https://www.Python.org ')).toEqual({ host: 'python.org', path: '', whole: true, start: 'https://www.python.org/' });
    expect(parseSite('docs.python.org/3/*')).toMatchObject({ whole: true, start: 'https://docs.python.org/3/' });
  });

  it('one page: ict.school.local/exams/y10-term1', () => {
    expect(parseSite('ict.school.local/exams/y10-term1')).toEqual({
      host: 'ict.school.local', path: '/exams/y10-term1', whole: false, start: 'https://ict.school.local/exams/y10-term1',
    });
    expect(parseSite('http://127.0.0.1:8080/questions.html?set=a')).toEqual({
      host: '127.0.0.1:8080', path: '/questions.html', whole: false, start: 'http://127.0.0.1:8080/questions.html?set=a',
    });
  });

  it('what isn\'t a web address is not taken', () => {
    for (const text of ['', '   ', 'two words', 'justaword', 'ftp://files.school.local/x', 'http://']) expect(parseSite(text), text).toBeUndefined();
    expect(parseSite('localhost:3000')).toMatchObject({ host: 'localhost:3000', whole: true });
  });
});

describe('F-10 F-13 what the exam browser opens', () => {
  const site = parseSite('docs.python.org/*')!;
  const page = parseSite('ict.school.local/exams/y10-term1')!;

  it('every page of a whole site, and nothing on another host', () => {
    expect(allowsPage(site, 'https://docs.python.org/3/library/csv.html#csv.reader')).toBe(true);
    expect(allowsPage(site, 'http://www.docs.python.org/')).toBe(true);
    expect(allowsPage(site, 'https://python.org/')).toBe(false);
    expect(allowsPage(site, 'https://docs.python.org.evil.example/3/')).toBe(false);
    expect(allowsPage(site, 'not an address')).toBe(false);
    expect(allowsPage(site, 'file:///C:/Users/lab/Documents/answers.html')).toBe(false);
  });

  it('one page is that page only, whatever comes after ? or #', () => {
    expect(allowsPage(page, 'https://ict.school.local/exams/y10-term1')).toBe(true);
    expect(allowsPage(page, 'https://ict.school.local/exams/y10-term1/?q=2#three')).toBe(true);
    expect(allowsPage(page, 'https://ict.school.local/exams/y11-mock')).toBe(false);
    expect(allowsPage(page, 'https://ict.school.local/')).toBe(false);
  });

  const sites = examSites([
    { url: 'ict.school.local/exams/y10-term1', hosts: ['fonts.gstatic.com', 'WWW.cdn.school.local'] },
    { url: 'docs.python.org/*', hosts: [] },
    { url: 'not a site', hosts: [] },
  ]);

  it('what can\'t be read is left out of the list', () => {
    expect(sites.map((s) => s.rule.host)).toEqual(['ict.school.local', 'docs.python.org']);
  });

  it('pages and frames must be on the list', () => {
    expect(decide({ url: 'https://ict.school.local/exams/y10-term1', type: 'mainFrame' }, sites)).toBe('allow');
    expect(decide({ url: 'https://docs.python.org/3/library/csv.html', type: 'subFrame' }, sites)).toBe('allow');
    expect(decide({ url: 'https://stackoverflow.com/questions/1/read-csv-python', type: 'mainFrame' }, sites)).toBe('block');
    expect(decide({ url: 'https://chat.example/embed', type: 'subFrame' }, sites)).toBe('block');
    // a host that only gives the question page its fonts is never a page
    expect(decide({ url: 'https://fonts.gstatic.com/', type: 'mainFrame' }, sites)).toBe('block');
  });

  it('a page\'s own files come from its site, or from the hosts recorded when the teacher added it', () => {
    expect(decide({ url: 'https://ict.school.local/static/exam.css', type: 'stylesheet' }, sites)).toBe('allow');
    expect(decide({ url: 'https://fonts.gstatic.com/s/inter.woff2', type: 'font' }, sites)).toBe('allow');
    expect(decide({ url: 'https://cdn.school.local/logo.png', type: 'image' }, sites)).toBe('allow');
    expect(decide({ url: 'wss://docs.python.org/live', type: 'webSocket' }, sites)).toBe('allow');
    expect(decide({ url: 'https://api.chat.example/v1/answers', type: 'xhr' }, sites)).toBe('block');
    expect(decide({ url: 'https://tracker.example/pixel.gif', type: 'image' }, sites)).toBe('block');
  });

  it('what a page makes itself is let through; other kinds of address are not', () => {
    expect(decide({ url: 'data:image/png;base64,AAAA', type: 'image' }, sites)).toBe('allow');
    expect(decide({ url: 'blob:https://ict.school.local/1234', type: 'media' }, sites)).toBe('allow');
    expect(decide({ url: 'about:blank', type: 'subFrame' }, sites)).toBe('allow');
    expect(decide({ url: 'file:///C:/Users/lab/Documents/answers.html', type: 'mainFrame' }, sites)).toBe('block');
    expect(decide({ url: 'not an address', type: 'mainFrame' }, sites)).toBe('block');
  });

  it('with no websites nothing opens', () => {
    expect(decide({ url: 'https://ict.school.local/', type: 'mainFrame' }, [])).toBe('block');
  });

  it('the blocked page names the host', () => {
    expect(hostOf('https://stackoverflow.com/questions/1')).toBe('stackoverflow.com');
    expect(hostOf('somewhere')).toBe('somewhere');
  });
});
