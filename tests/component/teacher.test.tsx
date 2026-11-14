import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '@lib/app/state';
import { TeacherApp } from '@/App';
import { feedLine } from '@/teacher/feed';
import { Live, lookOf } from '@/teacher/Live';
import { Lobby } from '@/teacher/Lobby';
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
      studentNames: 'Sokha Chan\nDara Kim\nDara Kim', minutes: 85, websites: [],
    });
  });

  it('the next exam starts with your name and the class you used last', async () => {
    const api = teacherApi();
    const classes = [{ id: 'c-1', name: 'Year 10 A', students: 26 }, { id: 'c-2', name: 'Year 11 B', students: 24 }];
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
    const tiles = screen.getAllByRole('definition').map((dd) => `${dd.previousSibling?.textContent}:${dd.textContent}`);
    expect(tiles).toEqual(['In the exam:2', 'Warnings:1', 'No contact:1', 'Left:1', 'Handed in:1', 'Not joined:2']);
    expect(screen.getByRole('timer')).toHaveTextContent('1:02:15');
    expect(screen.getByText('Year 10 A · started 09:30 · ends 11:00')).toBeInTheDocument();
    expect(students.map(lookOf)).toEqual(['ok', 'warn', 'left', 'lost', 'done', 'wait', 'wait']);
    const text = (name: string) => screen.getByRole('article', { name }).textContent;
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

  it('after the end: the hand-in folder, and Done', async () => {
    const api = teacherApi();
    render(<Live state={teacher({ screen: 'live', run: { ...run, endedAt: at('10:40') }, students })} api={api} />);
    expect(screen.getByText('Ended 10:40')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open the hand-in folder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(api.openFolder).toHaveBeenCalledOnce();
    expect(api.done).toHaveBeenCalledOnce();
  });

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
  });
});
