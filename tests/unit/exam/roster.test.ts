import { describe, expect, it } from 'vitest';
import { cells, parseRoster, rosterText } from '@lib/exam/roster';

describe('F-43 a class list from what the teacher has', () => {
  it('names typed one on each line, with odd spacing and empty lines', () => {
    expect(parseRoster('  Sokha   Chan \n\nDara Kim\r\n   \nVannak Sok\n')).toEqual({ students: [{ name: 'Sokha Chan' }, { name: 'Dara Kim' }, { name: 'Vannak Sok' }], skipped: [] });
    expect(parseRoster('')).toEqual({ students: [], skipped: [] });
  });

  it('rows pasted from a spreadsheet: a number, a name, a school email — in any order', () => {
    const pasted = '1\tSokha Chan\tSokha.Chan@school.edu\n2\tDara Kim\tdara.kim@school.edu\nvannak.sok@school.edu\tVannak Sok';
    expect(parseRoster(pasted).students).toEqual([
      { name: 'Sokha Chan', email: 'sokha.chan@school.edu', number: 1 }, { name: 'Dara Kim', email: 'dara.kim@school.edu', number: 2 },
      { name: 'Vannak Sok', email: 'vannak.sok@school.edu' },
    ]);
  });

  it('a spreadsheet file with a heading row; first and last names in their own columns', () => {
    const csv = String.fromCharCode(0xfeff) + 'No,First name,Last name,School email,House\r\n7,Mealea,Chea,mealea.chea@school.edu,Red\r\n8,"Heng, Jr.",Rithy,,Blue\r\n';
    expect(parseRoster(csv)).toEqual({
      students: [{ name: 'Mealea Chea', email: 'mealea.chea@school.edu', number: 7 }, { name: 'Heng, Jr. Rithy', number: 8 }], skipped: [],
    });
    expect(parseRoster('Name;Email\nSophea Lim;sophea.lim@school.edu').students).toEqual([{ name: 'Sophea Lim', email: 'sophea.lim@school.edu' }]);
    expect(parseRoster('Student\nBopha Ouk').students).toEqual([{ name: 'Bopha Ouk' }]);
  });

  it('F-02 two students with the same name are kept when their emails tell them apart', () => {
    const { students, skipped } = parseRoster('Sokha Chan\tsokha.chan@school.edu\nSokha Chan\tsokha.chan2@school.edu\nSokha Chan\tsokha.chan@school.edu');
    expect(students).toHaveLength(2);
    expect(skipped).toEqual([{ row: 3, why: 'sameEmail' }]);
  });

  it('a name typed twice, a row with no name, and something that isn\'t an email are dealt with and reported', () => {
    expect(parseRoster('Dara Kim\ndara kim\n12\nKosal Meas\tnot-an-email')).toEqual({
      students: [{ name: 'Dara Kim' }, { name: '12' }, { name: 'Kosal Meas not-an-email' }], skipped: [{ row: 2, why: 'twice' }],
    });
    expect(parseRoster('Name,Email\n,nobody@school.edu\nChenda Ly,chenda').students).toEqual([{ name: 'Chenda Ly' }]);
    expect(parseRoster('Name,Email\n,nobody@school.edu').skipped).toEqual([{ row: 2, why: 'noName' }]);
  });

  it('a line is cut into cells at tabs, else commas or semicolons; quotes keep a comma inside a cell', () => {
    expect(cells('a, "b, c" ,d')).toEqual(['a', 'b, c', 'd']);
    expect(cells('a\tb, c')).toEqual(['a', 'b, c']);
    expect(cells('a;b')).toEqual(['a', 'b']);
    expect(cells('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
    expect(cells('it"s,fine')).toEqual(['it"s', 'fine']);
  });

  it('a class goes back into the box as it can be read again', () => {
    const students = [{ name: 'Sokha Chan', email: 'sokha.chan@school.edu' }, { name: 'Dara Kim' }];
    expect(rosterText(students)).toBe('Sokha Chan\tsokha.chan@school.edu\nDara Kim');
    expect(parseRoster(rosterText(students)).students).toEqual(students);
  });
});
