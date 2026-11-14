import type { BrowserApi, StudentApi, TeacherApi } from '@lib/app/state';
import { useRemote } from '@/lib/remote';
import { BrowserShell } from './student/BrowserShell';
import { CantJoin } from './student/CantJoin';
import { ExamBar } from './student/ExamBar';
import { HandedIn } from './student/HandedIn';
import { HandIn } from './student/HandIn';
import { Join } from './student/Join';
import { Leave } from './student/Leave';
import { Waiting } from './student/Waiting';
import { After } from './teacher/After';
import { Live } from './teacher/Live';
import { Lobby } from './teacher/Lobby';
import { Home } from './teacher/Home';

/** The lab computer's own window: the plain screens before and after the exam, and Hand in. */
export function StudentApp({ api }: { api: StudentApi }) {
  const state = useRemote(api);
  if (!state) return null;
  switch (state.screen) {
    case 'join': return <Join state={state} api={api} />;
    case 'handIn': return <HandIn state={state} api={api} />;
    case 'leave': return <Leave state={state} api={api} />;
    case 'cantJoin': return <CantJoin state={state} api={api} />;
    case 'handedIn': return <HandedIn state={state} api={api} />;
    // during the exam this window is hidden: the exam bar is the screen
    default: return <Waiting state={state} />;
  }
}

export function BarApp({ api }: { api: StudentApi }) {
  const state = useRemote(api);
  return state ? <ExamBar state={state} api={api} /> : null;
}

export function BrowserApp({ api }: { api: BrowserApi }) {
  const state = useRemote(api);
  return state ? <BrowserShell state={state} api={api} /> : null;
}

export function TeacherApp({ api }: { api: TeacherApi }) {
  const state = useRemote(api);
  if (!state) return null;
  if (state.screen === 'lobby') return <Lobby state={state} api={api} />;
  if (state.screen === 'live') return <Live state={state} api={api} />;
  if (state.screen === 'ended') return <After state={state} api={api} />;
  return <Home state={state} api={api} />;
}

/** Which screen a window is was decided by the main process (`?view=`). */
export function App() {
  const { view, student, teacher, browser } = window.exammode;
  if (view === 'teacher' && teacher) return <TeacherApp api={teacher} />;
  if (view === 'bar' && student) return <BarApp api={student} />;
  if (view === 'browser' && browser) return <BrowserApp api={browser} />;
  return student ? <StudentApp api={student} /> : null;
}
