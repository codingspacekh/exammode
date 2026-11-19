import { describe, expect, it } from 'vitest';
import { ERRORS, ROUTES, baseOf, classList, errorOf, matchRoute, pathOf, urlOf, uploadReply } from '@contracts/network/http';

describe('the classroom protocol\'s HTTP routes (architecture §2.7): one table for the server and its clients', () => {
  it('a route\'s path is filled in, every part percent-encoded', () => {
    expect(pathOf('exams')).toBe('/exams');
    expect(pathOf('students', { run: 'r 1' })).toBe('/runs/r%201/students');
    expect(pathOf('given', { run: 'r', name: 'src/main.py' })).toBe('/runs/r/files/src%2Fmain.py');
  });

  it('a route\'s address on a computer, IPv6 in brackets', () => {
    expect(urlOf({ host: '10.0.0.5', port: 47800 }, 'upload')).toBe('http://10.0.0.5:47800/upload');
    expect(urlOf({ host: 'fe80::1', port: 47800 }, 'exams')).toBe('http://[fe80::1]:47800/exams');
    expect(baseOf({ host: 'teacher', port: 1 }, 'ws')).toBe('ws://teacher:1');
  });

  it('a request is matched to its route by method and path, its parts decoded', () => {
    expect(matchRoute('GET', '/exams')).toEqual({ route: 'exams', params: {} });
    expect(matchRoute('GET', '/runs/r%201/files/src%2Fmain.py')).toEqual({ route: 'given', params: { run: 'r 1', name: 'src/main.py' } });
    expect(matchRoute('POST', '/upload')).toEqual({ route: 'upload', params: {} });
  });

  it('what isn\'t a route is nothing: another method, another path, a part that isn\'t encoded properly', () => {
    expect(matchRoute('POST', '/exams')).toBeUndefined();
    expect(matchRoute('GET', '/upload')).toBeUndefined();
    expect(matchRoute('GET', '/runs/r/students/x')).toBeUndefined();
    expect(matchRoute(undefined, '/exams')).toBeUndefined();
    expect(matchRoute('GET', '/runs/%E0%A4%A/students')).toBeUndefined();
  });

  it('every route the server builds is matched back to itself', () => {
    const params = { run: 'a/b', name: 'c d' };
    for (const route of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
      const path = ROUTES[route].path.replace(/:([a-z]+)/g, (_, p: 'run' | 'name') => encodeURIComponent(params[p]));
      expect(matchRoute(ROUTES[route].method, path)?.route).toBe(route);
    }
  });

  it('an error is read by its name from the body; by its status only when there is none', () => {
    expect(errorOf(404, { error: 'noSuchRun' })).toBe('noSuchRun');
    expect(errorOf(413, { error: 'tooMuch' })).toBe('tooMuch');
    expect(errorOf(422, 'not json')).toBe('mismatch');
    expect(errorOf(418, undefined)).toBeUndefined();
    expect(ERRORS.unknown).toBe(401);
  });

  it('the replies have a shape and a size', () => {
    expect(classList.safeParse({ v: 1, students: [{ id: 's', name: 'Dara Kim' }] }).success).toBe(true);
    expect(classList.safeParse({ students: [{ id: 's', name: 'x'.repeat(201) }] }).success).toBe(false);
    expect(uploadReply.safeParse({ v: 1, ok: true, sig: 'x' }).success).toBe(true);
    expect(uploadReply.safeParse({ v: 1, type: 'receipt', code: 'ABC-DEF', files: [] }).success).toBe(true);
    expect(uploadReply.safeParse({ ok: true }).success).toBe(false);
  });
});
