import { vi } from 'vitest';
import type { BrowserApi, BrowserState, StudentApi, StudentState, StudentView, TeacherApi, TeacherState } from '@lib/app/state';

/** The prototype's exam (MILESTONES §3.1), as the screens are told it. */
export const at = (clock: string): number => {
  const [h = 0, m = 0, s = 0] = clock.split(':').map(Number);
  return new Date(2026, 10, 12, h, m, s).getTime();
};

const EXAM = { runId: 'run-1', title: 'Year 10 ICT — Term 1 practical exam', teacher: 'Ms Srey Leak', class: 'Year 10 A', minutes: 90, host: '10.0.0.2', port: 47800 };

export function student(over: Partial<StudentState> = {}): StudentState {
  return {
    screen: 'join', pc: 'PC-14', found: [EXAM, { ...EXAM, runId: 'run-2', title: 'Year 11 ICT — Mock paper 2', teacher: 'Mr Dara Ouk', class: 'Year 11 B', minutes: 120 }],
    names: [], joining: false, clockOffset: 0, contact: true, handingIn: false, locked: false, ...over,
  };
}

/** Sokha, joined: for the screens after 01. */
export function joined(over: Partial<StudentState> = {}): StudentState {
  return student({
    screen: 'waiting', picked: 'run-1', student: { id: 's-1', name: 'Sokha Chan' },
    exam: { runId: 'run-1', title: EXAM.title, teacher: 'Ms Srey Leak', minutes: 90, hasQuestions: false }, ...over,
  });
}

export function studentApi(state: StudentState = student()): StudentApi & { tell(next: StudentState): void } {
  const listeners = new Set<(s: StudentState) => void>();
  const done = () => vi.fn(async () => undefined);
  return {
    get: vi.fn(async () => state), onState: (l) => { listeners.add(l); return () => void listeners.delete(l); },
    tell: (next) => listeners.forEach((l) => l(next)),
    pick: done(), lookAt: done(), join: done(), checkAgain: done(), lock: done(), backOut: done(), askHandIn: done(), keepWorking: done(), handIn: done(), askLeave: done(), leave: done(), giveUp: done(), finish: done(), showQuestions: done(), openFolder: done(),
  };
}

export function card(name: string, over: Partial<StudentView> = {}): StudentView {
  return { id: name, name, state: 'notJoined', connected: false, warnings: 0, extraMinutes: 0, files: 0, failed: [], ...over };
}

export function teacher(over: Partial<TeacherState> = {}): TeacherState {
  return { screen: 'make', classes: [], exams: [], defaults: { teacher: '' }, students: [], feed: [], events: [], files: {}, ...over };
}

export const RUN = {
  id: 'run-1', code: '4817', title: EXAM.title, teacher: 'Ms Srey Leak', className: 'Year 10 A', minutes: 90, extraMinutes: 0, websites: [],
  folder: '/Hand-ins/Year 10 ICT', openedAt: at('09:20'),
};

export function teacherApi(state: TeacherState = teacher(), openAnswer?: string): TeacherApi {
  const done = () => vi.fn(async () => undefined);
  return { get: vi.fn(async () => state), onState: () => () => undefined, open: vi.fn(async () => openAnswer), saveExam: vi.fn(async () => openAnswer), openSaved: vi.fn(async () => openAnswer), copyExam: done(), deleteExam: vi.fn(async () => openAnswer),
    chooseFiles: vi.fn(async () => [{ name: 'marks.csv', bytes: 1024, path: '/Users/teacher/marks.csv' }]), saveClass: vi.fn(async () => openAnswer), deleteClass: vi.fn(async () => openAnswer),
    readListFile: vi.fn(async () => 'Name,Email\nBopha Ouk,bopha.ouk@school.edu'), start: done(), end: done(), letBackIn: done(), keepOut: done(), addTime: done(), done: done(), openFolder: done(), exportLog: vi.fn(async () => '/Hand-ins/Log.csv') };
}

export function browserApi(state: BrowserState): BrowserApi {
  const done = () => vi.fn(async () => undefined);
  return { get: vi.fn(async () => state), onState: () => () => undefined, select: done(), close: done(), back: done(), forward: done(), reload: done(), toQuestions: done() };
}
