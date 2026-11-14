import { describe, expect, it } from 'vitest';
import { folderName, isSafeName, isWorkFile, studentFolders } from '@lib/files/names';

describe('F-16 a file name from a lab computer', () => {
  it('a file in the Exam folder, or in a folder inside it, is accepted', () => {
    for (const name of ['Report.docx', 'site/index.html', 'robot/src/main.py', 'ចម្លើយ.txt', 'a b (2).xlsx', '.gitignore']) {
      expect(isSafeName(name), name).toBe(true);
    }
  });

  it('a name that would leave the student\'s folder on the teacher\'s laptop is refused', () => {
    for (const name of ['../Dara/Report.docx', 'a/../../b', '/etc/passwd', 'C:/Windows/x', 'a\\b.txt', '..', '.', '', 'a//b', 'a/', './a']) {
      expect(isSafeName(name), name).toBe(false);
    }
  });

  it('a name Windows can\'t store is refused, as the teacher\'s laptop may be a Windows one', () => {
    for (const name of ['a:b.txt', 'what?.txt', 'x*.py', 'a|b', '"q".txt', '<a>.txt', 'CON', 'nul.txt', 'folder/COM1.py', 'ends. ', 'dot.', 'tab\tname.txt', 'x'.repeat(241)]) {
      expect(isSafeName(name), name).toBe(false);
    }
  });
});

describe('F-22 files that aren\'t the student\'s work', () => {
  it('lock files and the system\'s own files are left out of backups and hand-ins', () => {
    for (const name of ['~$Report.docx', 'docs/~$Budget.xlsx', '.~lock.Report.odt#', 'Thumbs.db', 'pics/desktop.ini', '.DS_Store', 'Report.docx.part', '~WRL0001.tmp']) {
      expect(isWorkFile(name), name).toBe(false);
    }
    for (const name of ['Report.docx', 'main.py', 'notes~.txt', 'site/index.html']) expect(isWorkFile(name), name).toBe(true);
  });
});

describe('F-42 folders in Hand-ins', () => {
  it('a title becomes a folder name any computer can store', () => {
    expect(folderName('Year 10 ICT — Term 1 practical exam')).toBe('Year 10 ICT — Term 1 practical exam');
    expect(folderName('Q1: "Loops" / part 2?')).toBe('Q1 Loops part 2');
    expect(folderName('  ...  ')).toBe('Exam');
    expect(folderName('CON')).toBe('CON_');
    expect(folderName('x'.repeat(200))).toHaveLength(80);
  });

  it('F-02 two students with the same name are told apart by their school email', () => {
    const folders = studentFolders([
      { id: 's1', name: 'Sokha Chan', email: 'sokha.chan@school.edu' },
      { id: 's2', name: 'Dara Kim' },
      { id: 's3', name: 'Sokha Chan', email: 'sokha.chan2@school.edu' },
      { id: 's4', name: 'sokha chan' },
    ]);
    expect(folders.get('s1')).toBe('Sokha Chan (sokha.chan@school.edu)');
    expect(folders.get('s2')).toBe('Dara Kim');
    expect(folders.get('s3')).toBe('Sokha Chan (sokha.chan2@school.edu)');
    expect(folders.get('s4')).toBe('sokha chan (s4)');
  });
});
