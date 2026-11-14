import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '@lib/app/state';
import { TeacherApp } from '@/App';
import { After } from '@/teacher/After';
import { feedLine, timelineLine } from '@/teacher/feed';
import { Live, lookOf } from '@/teacher/Live';
import { Lobby } from '@/teacher/Lobby';
import { Home } from '@/teacher/Home';
import { MakeExam } from '@/teacher/MakeExam';
import { at, card, RUN, teacher, teacherApi } from './fakes';

afterEach(() => vi.useRealTimers());

describe('11 Make an exam — the minimal form (F-30, F-32)', () => {
  it('a first exam: the title, your name, a new class with its students, the time; questions on paper', async () => {
    const api = teacherApi();
    const user = userEvent.setup();
    render(<MakeExam state={teacher()} api={api} />);
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Year 10 ICT — Term 1 practical exam');
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Ms Srey Leak');
    await user.type(screen.getByRole('textbox', { name: 'The class\'s name' }), 'Year 10 A');
    await user.type(screen.getByRole('textbox', { name: /Students/ }), 'Sokha Chan{Enter}Dara Kim{Enter}Dara Kim');
    await user.click(screen.getByRole('button', { name: 'Less time' }));
    expect(screen.getByRole('group', { name: 'Time — counted from Start' })).toHaveTextContent('1 h 25 min');
    // what is ready, on the right: a name typed twice counts once
    expect(screen.getByText('2 students')).toBeInTheDocument();
    expect(screen.getByText('Questions on paper — no browser, no internet')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'The question page' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open for students…' }));
    expect(api.open).toHaveBeenCalledWith({
      teacher: 'Ms Srey Leak', title: 'Year 10 ICT — Term 1 practical exam', classId: undefined, className: 'Year 10 A',
      studentNames: 'Sokha Chan\nDara Kim\nDara Kim', minutes: 85, websites: [], files: [],
    });
  });

  it('the next exam starts with your name and the class you used last', async () => {
    const api = teacherApi();
    const classes = [{ id: 'c-1', name: 'Year 10 A', students: 26, roster: [] }, { id: 'c-2', name: 'Year 11 B', students: 24, roster: [] }];
    render(<MakeExam state={teacher({ classes, defaults: { teacher: 'Ms Srey Leak', classId: 'c-2' } })} api={api} />);
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('Ms Srey Leak');
    expect(screen.getByRole('combobox', { name: 'Class' })).toHaveTextContent('Year 11 B · 24 students');
    expect(screen.queryByRole('textbox', { name: /Students/ })).not.toBeInTheDocument();
    expect(screen.getByText('24 students in Year 11 B')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Mock paper 2');
    await userEvent.click(screen.getByRole('button', { name: 'Open for students…' }));
    expect(api.open).toHaveBeenCalledWith(expect.objectContaining({ classId: 'c-2', title: 'Mock paper 2', minutes: 90 }));
  });

  it('Q14 questions on a website: the question page first, then the other sites that are allowed', async () => {
    const api = teacherApi();
    const user = userEvent.setup();
    render(<MakeExam state={teacher()} api={api} />);
    await user.click(screen.getByRole('radio', { name: 'On a website' }));
    await user.type(screen.getByRole('textbox', { name: 'The question page' }), 'ict.school.local/exams/y10-term1');
    expect(screen.getByRole('button', { name: 'Take this website off' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add a website' }));
    await user.type(screen.getByRole('textbox', { name: 'Another website 1' }), 'docs.python.org/*');
    await user.click(screen.getByRole('button', { name: 'Add a website' }));
    expect(screen.getByText('2 websites')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Take this website off' })[2]!);
    await user.click(screen.getByRole('button', { name: 'Open for students…' }));
    expect(api.open).toHaveBeenCalledWith(expect.objectContaining({ websites: ['ict.school.local/exams/y10-term1', 'docs.python.org/*'] }));
    // back on paper, no website is sent
    await user.click(screen.getByRole('radio', { name: 'On paper' }));
    await user.click(screen.getByRole('button', { name: 'Open for students…' }));
    expect(api.open).toHaveBeenLastCalledWith(expect.objectContaining({ websites: [] }));
  });

  it('what is wrong with the form is said in words', async () => {
    render(<MakeExam state={teacher()} api={teacherApi(teacher(), 'Give the exam a title.')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open for students…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the exam a title.');
  });
});

describe('11 Make an exam — files to give, saving, changing (F-33, F-35)', () => {
  const classes = [{ id: 'c-1', name: 'Year 10 A', students: 26, roster: [] }];
  const kept = { id: 'e-1', title: 'Term 1 practical', teacher: 'Ms Srey Leak', classId: 'c-1', className: 'Year 10 A', minutes: 60, websites: ['ict.school.local/exams/y10-term1'], files: [{ name: 'sales.xlsx', bytes: 16_384 }], updatedAt: at('08:00'), runs: 1 };

  it('F-33 files are added from this computer, listed with their size, and can be taken off', async () => {
    const api = teacherApi();
    const user = userEvent.setup();
    render(<MakeExam state={teacher({ classes, defaults: { teacher: 'Ms Srey Leak', classId: 'c-1' } })} api={api} />);
    expect(screen.getByText('No files to give')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add files' }));
    expect(within(screen.getByRole('list', { name: 'Files to give' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['marks.csv1 KB']);
    expect(screen.getByText('1 file to give · 1 KB')).toBeInTheDocument();
    // the same file chosen again takes the first one's place
    await user.click(screen.getByRole('button', { name: 'Add files' }));
    expect(within(screen.getByRole('list', { name: 'Files to give' })).getAllByRole('listitem')).toHaveLength(1);
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Term 1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.saveExam).toHaveBeenCalledWith(expect.objectContaining({ title: 'Term 1', files: [{ name: 'marks.csv', bytes: 1024, path: '/Users/teacher/marks.csv' }] }));
    await user.click(screen.getByRole('button', { name: 'Take marks.csv off' }));
    expect(screen.queryByRole('list', { name: 'Files to give' })).not.toBeInTheDocument();
  });

  it('the rules are said, not switched', () => {
    render(<MakeExam state={teacher()} api={teacherApi()} />);
    expect(within(screen.getByRole('list', { name: 'Rules' })).getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent)).toEqual([
      'Leaving locks the student out', 'ExamMode closed suddenly counts as leaving', 'Hand in by itself when the time is up', 'A lost network is not leaving',
    ]);
  });

  it('F-35 a kept exam opens in the form as it was; Save keeps the changes under the same exam', async () => {
    const api = teacherApi();
    const closed = vi.fn();
    render(<MakeExam state={teacher({ classes, exams: [kept] })} api={api} exam={kept} onClose={closed} cancel />);
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Term 1 practical');
    expect(screen.getByRole('group', { name: 'Time — counted from Start' })).toHaveTextContent('1 h');
    expect(screen.getByRole('textbox', { name: 'The question page' })).toHaveValue('ict.school.local/exams/y10-term1');
    expect(screen.getByRole('list', { name: 'Files to give' })).toHaveTextContent('sales.xlsx16 KB');
    await userEvent.click(screen.getByRole('button', { name: 'More time' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.saveExam).toHaveBeenCalledWith(expect.objectContaining({ id: 'e-1', minutes: 65, classId: 'c-1', files: [{ name: 'sales.xlsx', bytes: 16_384 }] }));
    expect(closed).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('a form that can\'t be saved stays open and says why', async () => {
    const closed = vi.fn();
    render(<MakeExam state={teacher()} api={teacherApi(teacher(), 'Give the exam a title.')} onClose={closed} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the exam a title.');
    expect(closed).not.toHaveBeenCalled();
  });
});

describe('Exams and classes, between exams (F-35, F-43)', () => {
  const roster = [{ name: 'Dara Kim', email: 'dara.kim@school.edu' }, { name: 'Sokha Chan', email: 'sokha.chan@school.edu' }];
  const classes = [{ id: 'c-1', name: 'Year 10 A', students: 2, roster }, { id: 'c-2', name: 'Year 11 B', students: 1, roster: [{ name: 'Kosal Meas' }] }];
  const exam = (id: string, title: string, over = {}) => ({ id, title, teacher: 'Ms Srey Leak', classId: 'c-1', className: 'Year 10 A', minutes: 90, websites: [], files: [], updatedAt: at('08:00'), runs: 0, ...over });
  const exams = [exam('e-1', 'Term 1 practical', { runs: 2, files: [{ name: 'sales.xlsx', bytes: 1 }] }), exam('e-2', 'Mock paper 2', { websites: ['a.example/*', 'b.example/*'], minutes: 120 })];
  const home = teacher({ classes, exams, defaults: { teacher: 'Ms Srey Leak', classId: 'c-1' } });

  it('with nothing kept yet, the first thing is the form for a new exam (N-13)', () => {
    render(<Home state={teacher()} api={teacherApi()} />);
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('F-35 the kept exams are listed; each can be opened for students again, changed, copied or deleted', async () => {
    const api = teacherApi(home, 'This exam was run, and its hand-ins and log belong to it: it can\'t be deleted.');
    const user = userEvent.setup();
    render(<Home state={home} api={api} />);
    const rows = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').slice(0, 6).map((c) => c.textContent?.trim()));
    expect(rows).toEqual([
      ['Term 1 practical', 'Year 10 A', '1 h 30 min', 'On paper', '1', '12 Nov 2026 · run 2 times'],
      ['Mock paper 2', 'Year 10 A', '2 h', '2 websites', '—', '12 Nov 2026'],
    ]);
    await user.click(screen.getByRole('button', { name: 'Copy Mock paper 2' }));
    expect(api.copyExam).toHaveBeenCalledWith('e-2');
    await user.click(screen.getByRole('button', { name: 'Delete Term 1 practical' }));
    expect(api.deleteExam).toHaveBeenCalledWith('e-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('can\'t be deleted');
    await user.click(screen.getByRole('button', { name: 'Open Mock paper 2 for students' }));
    expect(api.openSaved).toHaveBeenCalledWith('e-2');

    await user.click(screen.getByRole('button', { name: 'Change Mock paper 2' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Mock paper 2');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'New exam' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('Ms Srey Leak');
  });

  it('F-43 a class shows its list as it can be edited; what was read from it is counted, and what is left out is said', async () => {
    const api = teacherApi(home);
    const user = userEvent.setup();
    render(<Home state={home} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Classes' }));
    expect(screen.getByRole('button', { name: 'Classes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Year 10 A');
    expect(screen.getByRole('textbox', { name: 'Students' })).toHaveValue('Dara Kim\tdara.kim@school.edu\nSokha Chan\tsokha.chan@school.edu');
    expect(screen.getByRole('status')).toHaveTextContent('2 students · 2 with a school email');

    await user.click(screen.getByRole('button', { name: /Year 11 B/ }));
    expect(screen.getByRole('textbox', { name: 'Students' })).toHaveValue('Kosal Meas');
    await user.type(screen.getByRole('textbox', { name: 'Students' }), '{Enter}kosal meas{Enter}Visal Long');
    expect(screen.getByRole('status')).toHaveTextContent('2 studentsLine 2 is left out: the same name is on the list already.');
    await user.click(screen.getByRole('button', { name: 'Save the class' }));
    expect(api.saveClass).toHaveBeenCalledWith({ id: 'c-2', name: 'Year 11 B', list: 'Kosal Meas\nkosal meas\nVisal Long' });
    await user.click(screen.getByRole('button', { name: 'Delete the class' }));
    expect(api.deleteClass).toHaveBeenCalledWith('c-2');
    await user.click(screen.getByRole('button', { name: 'Exams' }));
    expect(screen.getByRole('heading', { name: 'Your exams' })).toBeInTheDocument();
  });

  it('F-43 a new class from a spreadsheet file; it can\'t be saved without a name and at least one student', async () => {
    const api = teacherApi(home);
    const user = userEvent.setup();
    render(<Home state={home} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Classes' }));
    await user.click(screen.getByRole('button', { name: 'New class' }));
    expect(screen.getByRole('button', { name: 'Save the class' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete the class' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Read a spreadsheet file…' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 student · 1 with a school email');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Year 9 C');
    await user.click(screen.getByRole('button', { name: 'Save the class' }));
    expect(api.saveClass).toHaveBeenCalledWith({ id: undefined, name: 'Year 9 C', list: 'Name,Email\nBopha Ouk,bopha.ouk@school.edu' });
  });

  it('what the teacher\'s laptop says about a class is shown: something wrong, or news', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Home state={home} api={teacherApi(home, 'There is already a class called Year 10 A.')} />);
    await user.click(screen.getByRole('button', { name: 'Classes' }));
    await user.click(screen.getByRole('button', { name: 'Save the class' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is already a class called Year 10 A.');
    await user.click(screen.getByRole('button', { name: 'Delete the class' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is already a class called Year 10 A.');
    unmount();
    render(<Home state={home} api={teacherApi(home, 'Saved. 1 student who was taken off stays on the list: earlier exams have their work.')} />);
    await user.click(screen.getByRole('button', { name: 'Classes' }));
    await user.click(screen.getByRole('button', { name: 'Save the class' }));
    expect(await screen.findByRole('note')).toHaveTextContent('Saved. 1 student who was taken off stays');
  });
});

describe('12 Students joining (F-36, F-37)', () => {
  const students = [
    card('Vannak Sok'),
    card('Sokha Chan', { state: 'ready', pc: 'PC-14', joinedAt: at('09:24'), connected: true }),
    card('Sophea Lim', { state: 'checking', pc: 'PC-09', joinedAt: at('09:26'), connected: true }),
    card('Dara Kim', { state: 'ready', pc: 'PC-03', joinedAt: at('09:25'), connected: true }),
  ];
  const lobby = teacher({ screen: 'lobby', run: RUN, students });

  it('shows the code big enough for the board, and who is ready', () => {
    render(<Lobby state={lobby} api={teacherApi()} />);
    expect(screen.getByLabelText('Exam code 4 8 1 7')).toHaveTextContent('4817');
    expect(screen.getByText('Year 10 A · 1 h 30 min · not started')).toBeInTheDocument();
    expect(screen.getByText('of 4 students')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Students ready' })).toBeInTheDocument();
    expect(screen.getByText('1 student not here yet')).toBeInTheDocument();
  });

  it('lists the students who are here first, in the order they joined, with their computer and state', () => {
    render(<Lobby state={lobby} api={teacherApi()} />);
    const rows = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent?.trim()));
    expect(rows).toEqual([
      ['Sokha Chan', 'PC-14', '09:24', 'Ready'], ['Dara Kim', 'PC-03', '09:25', 'Ready'],
      ['Sophea Lim', 'PC-09', '09:26', 'Checking the computer…'], ['Vannak Sok', '—', '—', 'Not joined yet'],
    ]);
  });

  it('F-36 the code can be shown full screen, for the projector', async () => {
    const user = userEvent.setup();
    render(<Lobby state={lobby} api={teacherApi()} />);
    await user.click(screen.getByRole('button', { name: 'Show the code full screen' }));
    expect(screen.getByRole('dialog', { name: 'The exam code, full screen' })).toHaveTextContent('Year 10 ICT — Term 1 practical exam4817');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show the code full screen' }));
    await user.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('F-08 Start the exam starts it', async () => {
    const api = teacherApi();
    render(<Lobby state={lobby} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start the exam' }));
    expect(api.start).toHaveBeenCalledOnce();
  });
});

describe('13 The exam, live (F-38, F-39, F-41)', () => {
  const students = [
    card('Sokha Chan', { state: 'inExam', pc: 'PC-14', files: 2 }),
    card('Dara Kim', { state: 'inExam', pc: 'PC-03', warnings: 2, front: 'Excel · sales.xlsx' }),
    card('Vannak Sok', { state: 'left', pc: 'PC-07', leftAt: at('09:58'), leftHow: 'stoppedSuddenly', asksBackFrom: 'PC-02' }),
    card('Mealea Chea', { state: 'noContact', pc: 'PC-11' }),
    card('Rithy Heng', { state: 'handedIn', pc: 'PC-01', handedInAt: at('09:51'), handedInHow: 'handIn', receipt: 'HX7-29Q', files: 3 }),
    card('Visal Long'),
    card('Panha Choun', { state: 'checking', pc: 'PC-20' }),
  ];
  const run = { ...RUN, startedAt: at('09:30'), endsAt: at('11:00') };
  const feed: FeedItem[] = [
    { id: 3, at: at('09:58'), kind: 'stoppedSuddenly', student: 'Vannak Sok', pc: 'PC-07', details: {} },
    { id: 2, at: at('09:52'), kind: 'appClosed', student: 'Dara Kim', pc: 'PC-03', details: { app: 'Google Chrome' } },
    { id: 1, at: at('09:30'), kind: 'runStarted', details: {} },
    { id: 0, at: at('09:29'), kind: 'something-new', details: {} },
  ];
  const live = teacher({ screen: 'live', run, students, feed });

  it('counts the students by state, and gives each a card in its state\'s colour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('09:57:45'));
    render(<Live state={live} api={teacherApi()} />);
    const tiles = within(screen.getByRole('group', { name: 'Students by state' })).getAllByRole('button').map((b) => b.textContent);
    expect(tiles).toEqual(['In the exam2', 'Warnings1', 'No contact1', 'Left1', 'Handed in1', 'Not joined2']);
    expect(screen.getByRole('timer')).toHaveTextContent('1:02:15');
    expect(screen.getByText('Year 10 A · started 09:30 · ends 11:00')).toBeInTheDocument();
    expect(students.map(lookOf)).toEqual(['ok', 'warn', 'left', 'lost', 'done', 'wait', 'wait']);
    const text = (name: string) => screen.getByRole('button', { name }).textContent;
    expect(text('Sokha Chan')).toBe('Sokha ChanPC-14In the exam2 files backed up');
    expect(text('Dara Kim')).toBe('Dara KimPC-03 Warning 2Excel · sales.xlsx');
    expect(text('Vannak Sok')).toBe('Vannak SokPC-07 LeftLeft 09:58 · asks to come back');
    expect(text('Mealea Chea')).toBe('Mealea CheaPC-11 No contactThe computer can\'t be reached');
    // F-16 the receipt's code is on the teacher's list
    expect(text('Rithy Heng')).toBe('Rithy HengPC-01 Handed in09:51 · 3 files · HX7-29Q');
    expect(text('Visal Long')).toBe('Visal LongNot joinedNot here');
    expect(text('Panha Choun')).toBe('Panha ChounPC-20Checking…Joining late');
  });

  it('F-39 what\'s happening, newest first, in words', () => {
    render(<Live state={live} api={teacherApi()} />);
    const lines = within(screen.getByRole('list', { name: 'What\'s happening' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toEqual([
      'Vannak Sok left — ExamMode stopped suddenly on PC-0709:58', 'Dara Kim opened Google Chrome — closed09:52', 'The exam started09:30',
    ]);
  });

  it('F-41 End the exam asks first', async () => {
    const api = teacherApi();
    const user = userEvent.setup();
    render(<Live state={live} api={api} />);
    await user.click(screen.getByRole('button', { name: 'End the exam…' }));
    expect(screen.getByRole('alertdialog', { name: 'End the exam?' })).toHaveTextContent('End it for everyone and collect their work?');
    await user.click(screen.getByRole('button', { name: 'Keep going' }));
    expect(api.end).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'End the exam…' }));
    await user.click(screen.getByRole('button', { name: 'End the exam' }));
    expect(api.end).toHaveBeenCalledOnce();
  });

  const names = () => within(screen.getByRole('group', { name: 'Students' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));

  it('F-38 the counts filter the cards; so do Needs a look, Handed in, and the search', async () => {
    const user = userEvent.setup();
    render(<Live state={live} api={teacherApi()} />);
    expect(names()).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: /^Left/ }));
    expect(names()).toEqual(['Vannak Sok']);
    await user.click(screen.getByRole('button', { name: /^Left/ }));
    expect(names()).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: /^In the exam/ }));
    expect(names()).toEqual(['Sokha Chan', 'Dara Kim']);
    await user.click(screen.getByRole('radio', { name: 'Needs a look · 3' }));
    expect(names()).toEqual(['Dara Kim', 'Vannak Sok', 'Mealea Chea']);
    await user.click(screen.getByRole('radio', { name: 'Handed in · 1' }));
    expect(names()).toEqual(['Rithy Heng']);
    await user.click(screen.getByRole('radio', { name: 'Everyone · 7' }));
    await user.type(screen.getByRole('searchbox', { name: 'Find a student or computer' }), 'pc-0');
    expect(names()).toEqual(['Dara Kim', 'Vannak Sok', 'Rithy Heng']);
    await user.type(screen.getByRole('searchbox', { name: 'Find a student or computer' }), 'zzz');
    expect(screen.getByText('No student matches.')).toBeInTheDocument();
  });

  it('F-38 the same students as a list', async () => {
    render(<Live state={live} api={teacherApi()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'A list' }));
    const rows = within(screen.getByRole('table', { name: 'Students' })).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent?.trim()));
    expect(rows[1]).toEqual(['Dara Kim', 'PC-03', 'Warning', 'Excel · sales.xlsx', '2']);
    expect(rows[5]).toEqual(['Visal Long', '—', 'Not joined', 'Not here', '—']);
  });

  it('F-41 Add time for everyone: 5, 10 or 15 minutes', async () => {
    const api = teacherApi();
    const user = userEvent.setup();
    render(<Live state={live} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Add time' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.addTime).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add time' }));
    await user.click(within(screen.getByRole('group', { name: 'More time for everyone' })).getByRole('button', { name: '10 min' }));
    expect(api.addTime).toHaveBeenCalledWith(10);
  });

  it('the sound for what needs a look can be switched off', async () => {
    render(<Live state={live} api={teacherApi()} />);
    const sound = screen.getByRole('button', { name: 'sound on' });
    expect(sound).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(sound);
    expect(screen.getByRole('button', { name: 'sound off' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('13b One student — let back in? (F-18, F-20, F-40)', () => {
  const run = { ...RUN, startedAt: at('09:30'), endsAt: at('11:00') };
  const vannak = card('Vannak Sok', { state: 'left', pc: 'PC-07', joinedAt: at('09:26'), leftAt: at('09:58'), leftHow: 'stoppedSuddenly', asksBackFrom: 'PC-02', warnings: 1, files: 2 });
  const sokha = card('Sokha Chan', { state: 'inExam', pc: 'PC-14', joinedAt: at('09:24') });
  const event = (id: number, clock: string, kind: string, details = {}, pc = 'PC-07'): FeedItem => ({ id, at: at(clock), kind, studentId: 'Vannak Sok', student: 'Vannak Sok', pc, details });
  const events = [
    event(1, '09:26', 'joined'), event(2, '09:27', 'ready'), event(3, '09:30', 'started'), event(4, '09:44', 'appClosed', { app: 'Notepad' }),
    event(5, '09:58:12', 'stoppedSuddenly'), event(6, '09:59', 'asksBack', {}, 'PC-02'),
    { id: 7, at: at('09:59'), kind: 'handedIn', studentId: 'Sokha Chan', student: 'Sokha Chan', details: { how: 'handIn' } },
  ];
  const files = { 'Vannak Sok': [{ name: 'Report.docx', bytes: 9000, kind: 'backup' as const }, { name: 'sales.xlsx', bytes: 4000, kind: 'backup' as const }] };
  const live = teacher({ screen: 'live', run, students: [sokha, vannak], events, files, feed: [events[5]!] });

  it('a card opens the student\'s own timeline in the place of What\'s happening; Look in the feed does the same', async () => {
    const user = userEvent.setup();
    render(<Live state={live} api={teacherApi()} />);
    await user.click(screen.getByRole('button', { name: 'Look' }));
    const panel = within(screen.getByRole('region', { name: 'Vannak Sok' }));
    expect(screen.queryByRole('list', { name: 'What\'s happening' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vannak Sok' })).toHaveAttribute('aria-pressed', 'true');
    expect(panel.getAllByRole('definition').map((dd) => `${dd.previousSibling?.textContent}: ${dd.textContent}`)).toEqual([
      'Computer: PC-07 → PC-02', 'In the exam: 09:30 – 09:58', 'Warnings: 1', 'Files collected: 2',
    ]);
    expect(within(panel.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Joined on PC-0709:26', 'Ready: the computer passed its checks09:27', 'Exam started09:30', 'Opened Notepad — closed09:44',
      'ExamMode stopped suddenlyNo goodbye from PC-07 — closed from Task Manager or it crashed.09:58', 'Asked to come back in on PC-02Refused — waiting for you09:59',
    ]);
    expect(panel.getByText(/The exam opens on PC-02 by itself, with Vannak's files\. Time out of the exam: \d+ min\./)).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('list', { name: 'What\'s happening' })).toBeInTheDocument();
    // pressing the card again closes it too
    await user.click(screen.getByRole('button', { name: 'Vannak Sok' }));
    await user.click(screen.getByRole('button', { name: 'Vannak Sok' }));
    expect(screen.queryByRole('region', { name: 'Vannak Sok' })).not.toBeInTheDocument();
  });

  it('F-40 Let back in and Keep out go with a reason for the log', async () => {
    const api = teacherApi();
    const user = userEvent.setup();
    render(<Live state={live} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Vannak Sok' }));
    await user.click(screen.getByRole('button', { name: 'Let back in' }));
    expect(api.letBackIn).toHaveBeenCalledWith('Vannak Sok', 'The computer crashed');

    await user.click(screen.getByRole('combobox', { name: 'Reason (for the log)' }));
    await user.click(screen.getByRole('option', { name: 'Another reason…' }));
    // a reason has to be given
    expect(screen.getByRole('button', { name: 'Keep out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Let back in' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'The reason' }), 'Was seen with a phone');
    await user.click(screen.getByRole('button', { name: 'Keep out' }));
    expect(api.keepOut).toHaveBeenCalledWith('Vannak Sok', 'Was seen with a phone');
    await user.click(screen.getByRole('button', { name: 'Open Vannak\'s folder' }));
    expect(api.openFolder).toHaveBeenCalledWith('Vannak Sok');
  });

  it('a student who left but hasn\'t asked yet can be let back in ahead of time', async () => {
    render(<Live state={teacher({ ...live, students: [{ ...vannak, asksBackFrom: undefined }] })} api={teacherApi()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Vannak Sok' }));
    expect(screen.getByText('Vannak hasn\'t asked to come back yet. If you let them back in now, their next join is accepted.')).toBeInTheDocument();
  });

  it('F-41 a student in the exam can be given more time; there is nothing to decide about them', async () => {
    const api = teacherApi();
    render(<Live state={live} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sokha Chan' }));
    expect(screen.queryByRole('button', { name: 'Let back in' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Handed in09:59']);
    await userEvent.click(within(screen.getByRole('group', { name: 'More time for Sokha Chan' })).getByRole('button', { name: '15 min' }));
    expect(api.addTime).toHaveBeenCalledWith(15, 'Sokha Chan');
  });

  it('every kind of event has its line in a timeline', () => {
    const line = (kind: string, details: Record<string, unknown> = {}, pc?: string) => {
      const l = timelineLine({ id: 1, at: 0, kind, pc, details });
      return l.detail ? `${l.title} | ${l.detail}` : l.title;
    };
    expect(line('joined')).toBe('Joined');
    expect(line('joinedLate')).toBe('Started late, with the time that was left');
    expect(line('left')).toBe('Pressed Leave | Confirmed on the Leave screen. The work so far was collected as it was.');
    expect(line('stoppedSuddenly', { restarted: true })).toBe('ExamMode stopped suddenly | The computer was restarted.');
    expect(line('stoppedSuddenly')).toBe('ExamMode stopped suddenly | No goodbye — closed from Task Manager or it crashed.');
    expect(line('letBackIn', { reason: 'The computer crashed' })).toBe('You let them back in | Reason: The computer crashed');
    expect(line('letBackIn')).toBe('You let them back in');
    expect(line('keptOut', { reason: 'A phone' })).toBe('You kept them out | Reason: A phone');
    expect(line('keptOut')).toBe('You kept them out');
    expect(line('cameBack', { secondsOut: 420 }, 'PC-02')).toBe('Back in the exam on PC-02 | Out of the exam for 7 min');
    expect(line('cameBack')).toBe('Back in the exam | Out of the exam for 1 min');
    expect(line('noContact')).toBe('No contact | The computer couldn\'t be reached. Not leaving: it stays as it is.');
    expect(line('gap', { seconds: 45, localLog: [{}, {}, {}] })).toBe('Back in contact after 45 s | 2 things happened meanwhile, reported by the computer');
    expect(line('gap', { seconds: 12, localLog: [{}] })).toBe('Back in contact after 12 s');
    expect(line('timeAdded', { minutes: 10 })).toBe('10 minutes added');
    expect(line('handedIn', { how: 'timeUp' })).toBe('Handed in when the time ran out');
    expect(line('handedIn', { how: 'ended' })).toBe('Handed in when you ended the exam');
    expect(line('pageBlocked', { url: 'https://stackoverflow.com/q' })).toBe('Clicked a site that isn\'t allowed — stackoverflow.com');
    expect(line('checkFailed', { check: 'oneScreen' })).toBe('This computer can\'t start: oneScreen');
    expect(line('something-new')).toBe('Something-new');
  });
});

describe('14 After the exam (F-17, F-42)', () => {
  const run = { ...RUN, startedAt: at('09:30'), endsAt: at('11:00'), endedAt: at('11:00') };
  const students = [
    card('Sokha Chan', { state: 'handedIn', pc: 'PC-14', handedInAt: at('10:58'), handedInHow: 'handIn', receipt: 'HX7-29Q' }),
    card('Dara Kim', { state: 'handedIn', pc: 'PC-03', handedInAt: at('11:00'), handedInHow: 'timeUp', receipt: 'K3M-8PD', warnings: 2 }),
    card('Bopha Ouk', { state: 'handedIn', pc: 'PC-12', handedInAt: at('10:40'), handedInHow: 'ended', receipt: 'ZZ2-4QW' }),
    card('Vannak Sok', { state: 'left', pc: 'PC-07', leftAt: at('09:58'), leftHow: 'stoppedSuddenly', warnings: 1 }),
    card('Mealea Chea', { state: 'noContact', pc: 'PC-11' }),
    card('Kosal Meas', { state: 'inExam', pc: 'PC-19' }),
    card('Visal Long'),
  ];
  const file = (name: string, kind: 'backup' | 'handIn' | 'timeUp' = 'handIn') => ({ name, bytes: 10_240, kind });
  const files = {
    'Sokha Chan': [file('Report.docx'), file('grades.py'), file('scrap.txt', 'backup')], 'Dara Kim': [file('sales.xlsx', 'timeUp')],
    'Vannak Sok': [file('Report.docx', 'backup')], 'Mealea Chea': [file('Report.docx', 'backup')],
  };
  const ended = teacher({ screen: 'ended', run, students, files });

  it('counts how each exam ended, and lists every student with when, how, their files and receipt', () => {
    render(<After state={ended} api={teacherApi()} />);
    expect(screen.getAllByRole('definition').map((dd) => `${dd.previousSibling?.textContent}: ${dd.textContent}`)).toEqual([
      'Handed in: 1', 'Handed in when time ran out: 2', 'Left — work up to then: 1', 'Students with warnings: 2',
    ]);
    expect(screen.getByText('Year 10 A · 09:30 – 11:00')).toBeInTheDocument();
    expect(screen.getByText('7 students · 5 files · 50 KB')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').slice(0, 8).map((c) => c.textContent?.trim()));
    expect(rows).toEqual([
      // a backup that isn't in the hand-in isn't listed with it
      ['Sokha Chan', 'PC-14', 'Handed in', '10:58', 'Pressed Hand in', 'Report.docxgrades.py', 'HX7-29Q', '—'],
      ['Dara Kim', 'PC-03', 'Time up', '11:00', 'Handed in by itself', 'sales.xlsx', 'K3M-8PD', '2'],
      ['Bopha Ouk', 'PC-12', 'Ended', '10:40', 'Handed in when you ended the exam', '—', 'ZZ2-4QW', '—'],
      ['Vannak Sok', 'PC-07', 'Left 09:58', '09:58', 'Files up to 09:58', 'Report.docx', '—', '1'],
      ['Mealea Chea', 'PC-11', 'No hand-in', '—', 'No contact at the end — the latest backup', 'Report.docx', '—', '—'],
      ['Kosal Meas', 'PC-19', 'No hand-in', '—', 'No contact at the end — nothing received', '—', '—', '—'],
      ['Visal Long', '—', 'Didn\'t join', '—', '—', '—', '—', '—'],
    ]);
  });

  it('opens the hand-in folder or one student\'s, exports the log, and is done', async () => {
    const api = teacherApi();
    const user = userEvent.setup();
    render(<After state={ended} api={api} />);
    await user.click(screen.getByRole('button', { name: 'Open the hand-in folder' }));
    expect(api.openFolder).toHaveBeenLastCalledWith();
    await user.click(screen.getByRole('button', { name: 'Open Vannak Sok\'s folder' }));
    expect(api.openFolder).toHaveBeenLastCalledWith('Vannak Sok');
    await user.click(screen.getByRole('button', { name: 'Export the log (CSV)' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The log was saved as /Hand-ins/Log.csv');
    await user.type(screen.getByRole('searchbox', { name: 'Find a student' }), 'kim');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(api.done).toHaveBeenCalledOnce();
  });
});

describe('13 the feed\'s words', () => {
  it('every kind of event has its line', () => {
    const line = (kind: string, details: Record<string, unknown> = {}, student: string | null = 'Dara Kim', pc: string | null = 'PC-03') => {
      const l = feedLine({ id: 1, at: 0, kind, student: student ?? undefined, pc: pc ?? undefined, details });
      return `${l?.who ?? ''}|${l?.text}`;
    };
    expect(line('runEnded', {}, null)).toBe('|You ended the exam');
    expect(line('timeAdded', { minutes: 5 }, null)).toBe('|5 minutes added for everyone');
    expect(line('timeAdded', { minutes: 10 })).toBe('Dara Kim|— 10 minutes added');
    expect(line('joinedLate')).toBe('Dara Kim|joined late on PC-03');
    expect(line('handedIn', { how: 'handIn' })).toBe('Dara Kim|handed in');
    expect(line('handedIn', { how: 'timeUp' })).toBe('Dara Kim|was handed in when the time ran out');
    expect(line('handedIn', { how: 'ended' })).toBe('Dara Kim|was handed in when you ended the exam');
    expect(line('left')).toBe('Dara Kim|left — pressed Leave on PC-03');
    expect(line('stoppedSuddenly', { restarted: true }, 'Dara Kim', null)).toBe('Dara Kim|left — ExamMode stopped suddenly; the computer was restarted');
    expect(line('asksBack')).toBe('Dara Kim|asks to come back in on PC-03');
    expect(line('letBackIn')).toBe('Dara Kim|was let back in');
    expect(line('cameBack')).toBe('Dara Kim|is back in the exam on PC-03');
    expect(line('keptOut')).toBe('Dara Kim|was kept out');
    expect(line('noContact')).toBe('Dara Kim|— no contact with PC-03');
    expect(line('noContact', {}, 'Dara Kim', null)).toBe('Dara Kim|— no contact');
    expect(line('gap', { seconds: 45 })).toBe('Dara Kim|is back in contact after 45 s');
    expect(line('appClosed')).toBe('Dara Kim|opened an app that isn\'t allowed — closed');
    expect(line('pageBlocked', { url: 'https://stackoverflow.com/questions/1' })).toBe('Dara Kim|clicked a site that isn\'t allowed — stackoverflow.com');
    expect(line('pageBlocked', { url: 'somewhere' })).toBe('Dara Kim|clicked a site that isn\'t allowed — somewhere');
    expect(line('pageBlocked')).toBe('Dara Kim|clicked a site that isn\'t allowed — a website');
    expect(line('displayAdded')).toBe('Dara Kim|plugged in a second screen');
    expect(line('checkFailed', { check: 'oneScreen' })).toBe('Dara Kim|— this computer can\'t start: oneScreen');
    expect(line('leftBeforeStart')).toBe('Dara Kim|left before the start');
    expect(line('nameTaken', {}, 'Dara Kim', 'PC-12')).toBe('Dara Kim|— someone on PC-12 picked this name');
    expect(line('nameTaken', {}, 'Dara Kim', null)).toBe('Dara Kim|— someone on another computer picked this name');
    expect(line('codeWrong', {}, null, 'PC-09')).toBe('|A wrong code was typed on PC-09');
  });
});

describe('the teacher\'s window follows what the main process says', () => {
  it('shows the screen of the state it is told', async () => {
    const listeners: ((s: ReturnType<typeof teacher>) => void)[] = [];
    const api = { ...teacherApi(), onState: (l: (s: ReturnType<typeof teacher>) => void) => { listeners.push(l); return () => undefined; } };
    render(<TeacherApp api={api} />);
    expect(await screen.findByRole('button', { name: 'Open for students…' })).toBeInTheDocument();
    act(() => listeners.forEach((l) => l(teacher({ screen: 'lobby', run: RUN, students: [card('Sokha Chan')] }))));
    expect(screen.getByRole('button', { name: 'Start the exam' })).toBeInTheDocument();
    act(() => listeners.forEach((l) => l(teacher({ screen: 'live', run: { ...RUN, startedAt: at('09:30'), endsAt: at('11:00') }, students: [card('Sokha Chan', { state: 'inExam' })] }))));
    expect(screen.getByRole('button', { name: 'End the exam…' })).toBeInTheDocument();
    act(() => listeners.forEach((l) => l(teacher({ screen: 'ended', run: { ...RUN, startedAt: at('09:30'), endsAt: at('11:00'), endedAt: at('10:40') }, students: [card('Sokha Chan')] }))));
    expect(screen.getByRole('heading', { name: 'Hand-ins' })).toBeInTheDocument();
  });
});
