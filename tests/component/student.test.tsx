import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentApp } from '@/App';
import { BrowserShell } from '@/student/BrowserShell';
import { CantJoin } from '@/student/CantJoin';
import { ExamBar } from '@/student/ExamBar';
import { HandedIn } from '@/student/HandedIn';
import { HandIn } from '@/student/HandIn';
import { Join } from '@/student/Join';
import { Leave } from '@/student/Leave';
import { Waiting } from '@/student/Waiting';
import { at, browserApi, joined, student, studentApi } from './fakes';

const NAMES = [{ id: 's-1', name: 'Sokha Chan' }, { id: 's-2', name: 'Dara Kim', email: 'dara.kim@school.edu' }];
afterEach(() => vi.useRealTimers());

describe('01 Join an exam (F-01, F-02, F-03)', () => {
  it('lists the exams that are open, with the teacher, the class and the time', () => {
    render(<Join state={student()} api={studentApi()} />);
    expect(screen.getByRole('heading', { name: 'Join your exam' })).toBeInTheDocument();
    const exams = screen.getAllByRole('radio');
    expect(exams).toHaveLength(2);
    expect(exams[0]).toHaveTextContent('Year 10 ICT — Term 1 practical examMs Srey Leak · Year 10 A · 1 h 30 min');
    expect(screen.getByText('PC-14')).toBeInTheDocument();
  });

  it('choosing an exam asks for its class list', async () => {
    const api = studentApi();
    render(<Join state={student()} api={api} />);
    await userEvent.click(screen.getByRole('radio', { name: /Year 11 ICT/ }));
    expect(api.pick).toHaveBeenCalledWith('run-2');
  });

  it('F-02 F-03 Join is disabled until an exam, a name and 4 digits; then it joins with them', async () => {
    const api = studentApi();
    const user = userEvent.setup();
    const { rerender } = render(<Join state={student()} api={api} />);
    const join = screen.getByRole('button', { name: /^Join/ });
    expect(join).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Your name' })).toBeDisabled();

    rerender(<Join state={student({ picked: 'run-1', names: NAMES })} api={api} />);
    expect(screen.getByRole('radio', { name: /Year 10 ICT/ })).toBeChecked();
    await user.click(screen.getByRole('combobox', { name: 'Your name' }));
    // two students can share a name: the email tells them apart
    expect(screen.getByRole('option', { name: /Dara Kim\s*·\s*dara\.kim@school\.edu/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Sokha Chan' }));
    expect(join).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Exam code' }), '48x1');
    expect(join).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Exam code' }), '7');
    expect(join).toBeEnabled();
    await user.click(join);
    expect(api.join).toHaveBeenCalledWith('s-1', '4817');
  });

  it('while joining, Join can\'t be pressed twice', () => {
    render(<Join state={student({ picked: 'run-1', names: NAMES, joining: true })} api={studentApi()} />);
    expect(screen.getByRole('button', { name: /Joining/ })).toBeDisabled();
  });

  it('F-03 a refused join says why, in words', () => {
    const { rerender } = render(<Join state={student({ joinError: 'codeWrong' })} api={studentApi()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('That isn\'t the code on the board');
    rerender(<Join state={student({ joinError: 'nameTaken' })} api={studentApi()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('already in this exam on another computer');
    rerender(<Join state={student({ joinError: 'left' })} api={studentApi()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('You left this exam, so you can\'t join it again');
  });

  it('F-03 after a wrong code the boxes are empty again, ready for the right one', async () => {
    const picked = { picked: 'run-1', names: NAMES };
    const { rerender } = render(<Join state={student(picked)} api={studentApi()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Exam code' }), '0000');
    rerender(<Join state={student({ ...picked, joining: true })} api={studentApi()} />);
    rerender(<Join state={student({ ...picked, joinError: 'codeWrong' })} api={studentApi()} />);
    expect(screen.getByRole('textbox', { name: 'Exam code' })).toHaveValue('');
  });

  it('F-01 with no exam found, the teacher\'s computer name can be typed in', async () => {
    const api = studentApi();
    const user = userEvent.setup();
    render(<Join state={student({ found: [] })} api={api} />);
    expect(screen.getByText('Looking for exams on the classroom network…')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your teacher\'s computer name' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'type your teacher\'s computer name' }));
    const look = screen.getByRole('button', { name: 'Look there' });
    expect(look).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Your teacher\'s computer name' }), 'MS-LEAK-LAPTOP');
    await user.click(look);
    expect(api.lookAt).toHaveBeenCalledWith('MS-LEAK-LAPTOP');
  });
});

describe('03 Waiting for the teacher (F-08)', () => {
  it('says who is waited for, the time, the name and the computer, and that leaving can\'t be undone', () => {
    render(<Waiting state={joined()} />);
    expect(screen.getByRole('heading', { name: 'You\'re in. Waiting for Ms Srey Leak to start.' })).toBeInTheDocument();
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument();
    expect(screen.getByText('Sokha Chan')).toBeInTheDocument();
    expect(screen.getByText('The questions are on paper.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('If you leave the exam, you can\'t come back in');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the teacher');
  });

  it('Q14 an exam with websites says the questions can be used', () => {
    const state = joined();
    render(<Waiting state={{ ...state, exam: { ...state.exam!, hasQuestions: true } }} />);
    expect(screen.getByText('The questions')).toBeInTheDocument();
    expect(screen.queryByText('The questions are on paper.')).not.toBeInTheDocument();
  });
});

describe('04 The exam bar (F-09)', () => {
  const inExam = (over = {}) => joined({ screen: 'exam', endsAt: at('11:00'), ...over });

  it('shows the exam, who and where, and the time left, counted on the teacher\'s clock', () => {
    vi.useFakeTimers();
    // this computer's clock is 2 minutes behind the teacher's
    vi.setSystemTime(at('09:45:20'));
    render(<ExamBar state={inExam({ clockOffset: 120_000 })} api={studentApi()} />);
    expect(screen.getByText('EXAM')).toBeInTheDocument();
    expect(screen.getByText('Year 10 ICT — Term 1 practical exam')).toBeInTheDocument();
    expect(screen.getByText('Sokha Chan · PC-14 · set by Ms Srey Leak')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('1:12:40');
    expect(screen.getByText('left · ends 10:58')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole('timer')).toHaveTextContent('1:12:38');
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
  });

  it('F-19 with no contact it says so, and to keep working', () => {
    render(<ExamBar state={inExam({ contact: false })} api={studentApi()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Can\'t reach Ms Srey Leak — keep working');
  });

  it('Hand in… and Exam folder ask for them; Questions is there only when the exam has websites', async () => {
    const api = studentApi();
    const { rerender } = render(<ExamBar state={inExam()} api={api} />);
    expect(screen.queryByRole('button', { name: 'Questions' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hand in…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Exam folder' }));
    expect(api.askHandIn).toHaveBeenCalledOnce();
    expect(api.openFolder).toHaveBeenCalledOnce();

    const state = inExam();
    rerender(<ExamBar state={{ ...state, exam: { ...state.exam!, hasQuestions: true } }} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(api.showQuestions).toHaveBeenCalledOnce();
  });

  it('10b with no contact a strip under the bar says so, and counts how long', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('09:45:42'));
    render(<ExamBar state={inExam({ contact: false, lostAt: at('09:45') })} api={studentApi()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Can\'t reach the teacher\'s computer. Keep working — your work is saved on this computer. Trying again · 0:42');
  });

  it('F-15 the door at the end of the bar asks about leaving', async () => {
    const api = studentApi();
    render(<ExamBar state={inExam()} api={api} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Leave the exam…' }));
    expect(api.askLeave).toHaveBeenCalledOnce();
  });

  it('while Hand in is open, the bar\'s Hand in… can\'t be pressed again', () => {
    render(<ExamBar state={inExam({ screen: 'handIn' })} api={studentApi()} />);
    expect(screen.getByRole('button', { name: 'Hand in…' })).toBeDisabled();
  });
});

describe('08 Leave the exam? (F-15)', () => {
  const FILES = [{ name: 'Report.docx', bytes: 24_576, modified: at('09:57') }];
  const asking = (over = {}) => joined({ screen: 'leave', handIn: { files: FILES, unchanged: [] }, ...over });

  it('says it can\'t be undone, and lists the work that is handed in as it is', () => {
    render(<Leave state={asking()} api={studentApi()} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Leave the exam?' });
    expect(dialog).toHaveTextContent('you can\'t come back into this exam — not on this computer and not on another one. Only Ms Srey Leak can let you back in.');
    expect(within(screen.getByRole('list', { name: 'Your work so far' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Report.docxsaved 09:57']);
  });

  it('Leave stays greyed out until the box is ticked; Stay is the button already chosen', async () => {
    const api = studentApi();
    const user = userEvent.setup();
    render(<Leave state={asking()} api={api} />);
    const leave = screen.getByRole('button', { name: 'Leave the exam' });
    expect(leave).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stay in the exam' })).toHaveFocus();
    await user.click(screen.getByRole('checkbox', { name: 'I understand I can\'t come back into this exam' }));
    expect(leave).toBeEnabled();
    await user.click(leave);
    expect(api.leave).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Stay in the exam' }));
    expect(api.keepWorking).toHaveBeenCalledOnce();
  });

  it('while leaving, nothing can be pressed twice', () => {
    render(<Leave state={asking({ handingIn: true, handIn: { files: [], unchanged: [] } })} api={studentApi()} />);
    expect(screen.getByRole('button', { name: 'Leaving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stay in the exam' })).toBeDisabled();
    expect(screen.getByText('There is nothing in your Exam folder.')).toBeInTheDocument();
  });
});

describe('10 Can\'t join again (F-18, F-20)', () => {
  it('says when, where and how the student left, that the teacher was told, and waits', async () => {
    const api = studentApi();
    render(<CantJoin state={joined({ screen: 'cantJoin', pc: 'PC-02', left: { at: at('09:58'), how: 'stoppedSuddenly', pc: 'PC-07' } })} api={api} />);
    expect(screen.getByRole('heading', { name: 'You can\'t join this exam again' })).toBeInTheDocument();
    expect(screen.getAllByRole('definition').map((dd) => dd.textContent)).toEqual(['Sokha Chan', '09:58 on PC-07', 'ExamMode stopped suddenly', 'Handed in as it was at 09:58']);
    expect(screen.getByRole('note')).toHaveTextContent('Ms Srey Leak has been told you\'d like to come back.');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Ms Srey Leak…');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(api.giveUp).toHaveBeenCalledOnce();
  });

  it('a student who pressed Leave on this computer is told so', () => {
    render(<CantJoin state={joined({ screen: 'cantJoin', left: { at: at('10:05'), how: 'pressedLeave', pc: 'PC-14' } })} api={studentApi()} />);
    expect(screen.getAllByRole('definition').map((dd) => dd.textContent).slice(1, 3)).toEqual(['10:05 on this computer', 'You pressed Leave']);
  });
});

describe('09 Hand in (F-16)', () => {
  const FILES = [{ name: 'Report.docx', bytes: 24_576, modified: at('10:41') }, { name: 'code/grades.py', bytes: 2048, modified: at('10:36') }];
  const asking = (over = {}) => joined({ screen: 'handIn', endsAt: at('11:00'), handIn: { files: FILES, unchanged: [{ name: 'marks.csv', bytes: 1024, modified: at('09:30') }] }, ...over });

  it('lists the files that go, the given files that weren\'t changed apart, and the time left', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('10:41:56'));
    render(<HandIn state={asking()} api={studentApi()} />);
    const list = within(screen.getByRole('list', { name: 'Your work' }));
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Your work — 2 files', 'Report.docx24 KB · 10:41', 'code/grades.py2 KB · 10:36', 'Given by Ms Srey Leak, not changed', 'marks.csv1 KB · 09:30',
    ]);
    expect(screen.getByRole('note')).toHaveTextContent('18 minutes are left. You can\'t come back into the exam after you hand in.');
  });

  it('an empty Exam folder says so, and can still be handed in', () => {
    render(<HandIn state={asking({ handIn: { files: [], unchanged: [] } })} api={studentApi()} />);
    expect(screen.getByText('There is nothing in your Exam folder. Save your work there first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand in now' })).toBeEnabled();
  });

  it('Keep working goes back; Hand in now hands in, once', async () => {
    const api = studentApi();
    const { rerender } = render(<HandIn state={asking()} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Keep working' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hand in now' }));
    expect(api.keepWorking).toHaveBeenCalledOnce();
    expect(api.handIn).toHaveBeenCalledOnce();
    rerender(<HandIn state={asking({ handingIn: true })} api={api} />);
    expect(screen.getByRole('button', { name: 'Handing in…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep working' })).toBeDisabled();
  });
});

describe('09b Handed in (F-16, F-17)', () => {
  const receipt = { code: 'HX7-29Q', at: at('10:42'), byItself: false, files: [{ name: 'Report.docx', bytes: 24_576 }, { name: 'sales.xlsx', bytes: 18_432 }] };

  it('shows the receipt, with the code that is on the teacher\'s list', () => {
    render(<HandedIn state={joined({ screen: 'handedIn', receipt })} api={studentApi()} />);
    expect(screen.getByRole('heading', { name: 'Handed in' })).toBeInTheDocument();
    expect(screen.getByText('Ms Srey Leak has your work. You can\'t change it now.')).toBeInTheDocument();
    expect(screen.getByText('HX7-29Q')).toBeInTheDocument();
    expect(screen.getByText('Report.docx, sales.xlsx · 42 KB')).toBeInTheDocument();
    expect(screen.getByText('10:42')).toBeInTheDocument();
  });

  it('F-17 a hand-in at the end of the time says it was handed in by itself', () => {
    render(<HandedIn state={joined({ screen: 'handedIn', receipt: { ...receipt, byItself: true, files: [] } })} api={studentApi()} />);
    expect(screen.getByText('10:42, by itself when the exam ended')).toBeInTheDocument();
    expect(screen.getByText('No files')).toBeInTheDocument();
  });

  it('Finish puts ExamMode back as it was', async () => {
    const api = studentApi();
    render(<HandedIn state={joined({ screen: 'handedIn', receipt })} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(api.finish).toHaveBeenCalledOnce();
  });
});

describe('04 / 07b The exam browser (F-10, F-13)', () => {
  const tab = (over = {}) => ({ id: 1, title: 'Term 1 practical — questions', url: 'https://ict.school.local/exams/y10-term1', loading: false, canGoBack: false, canGoForward: false, ...over });
  const sites = ['ict.school.local/exams/y10-term1', 'docs.python.org'];

  it('shows the page\'s address without a box to type in, and tabs for the exam\'s pages', async () => {
    const api = browserApi({ tabs: [tab(), tab({ id: 2, title: 'csv — Python 3 docs', url: 'https://docs.python.org/3/library/csv.html', canGoBack: true })], active: 2, sites });
    render(<BrowserShell state={await api.get()} api={api} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('This page\'s address')).toHaveTextContent('docs.python.org/3/library/csv.html');
    expect(screen.getByText('Only the exam\'s websites open here')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'csv — Python 3 docs' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Term 1 practical — questions' }));
    expect(api.select).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(api.back).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
    // the questions' tab stays; the others can be closed
    expect(screen.getAllByRole('button', { name: /^Close/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close csv — Python 3 docs' }));
    expect(api.close).toHaveBeenCalledWith(2);
  });

  it('F-13 a page that isn\'t part of the exam says so, names the site, and offers the way back', async () => {
    const api = browserApi({ tabs: [tab({ blocked: 'stackoverflow.com' })], active: 1, sites });
    render(<BrowserShell state={await api.get()} api={api} />);
    expect(screen.getByRole('heading', { name: 'This page isn\'t part of the exam' })).toBeInTheDocument();
    expect(screen.getAllByText('stackoverflow.com')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Not part of the exam' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Allowed sites' }));
    expect(within(screen.getByRole('list', { name: 'Allowed sites' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(sites);
    await userEvent.click(screen.getByRole('button', { name: 'Back to the questions' }));
    expect(api.toQuestions).toHaveBeenCalledOnce();
  });

  it('an allowed page has no message over it', async () => {
    const api = browserApi({ tabs: [tab()], active: 1, sites });
    render(<BrowserShell state={await api.get()} api={api} />);
    expect(screen.queryByRole('heading', { name: 'This page isn\'t part of the exam' })).not.toBeInTheDocument();
  });
});

describe('the lab computer\'s window follows what the main process says', () => {
  it('shows the screen of the state it is told', async () => {
    const api = studentApi(student());
    render(<StudentApp api={api} />);
    expect(await screen.findByRole('heading', { name: 'Join your exam' })).toBeInTheDocument();
    act(() => api.tell(joined()));
    expect(screen.getByRole('heading', { name: /Waiting for Ms Srey Leak/ })).toBeInTheDocument();
    act(() => api.tell(joined({ screen: 'handIn', handIn: { files: [], unchanged: [] } })));
    expect(screen.getByRole('dialog', { name: 'Hand in your work' })).toBeInTheDocument();
    act(() => api.tell(joined({ screen: 'handedIn', receipt: { code: 'HX7-29Q', at: at('10:42'), byItself: false, files: [] } })));
    expect(screen.getByRole('heading', { name: 'Handed in' })).toBeInTheDocument();
    act(() => api.tell(joined({ screen: 'leave', handIn: { files: [], unchanged: [] } })));
    expect(screen.getByRole('alertdialog', { name: 'Leave the exam?' })).toBeInTheDocument();
    act(() => api.tell(joined({ screen: 'cantJoin' })));
    expect(screen.getByRole('heading', { name: 'You can\'t join this exam again' })).toBeInTheDocument();
  });
});
