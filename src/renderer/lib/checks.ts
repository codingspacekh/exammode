import type { Check, CheckName } from '@lib/lockdown/checks';

/** A check in words, for the student (02): what it is, and — when it fails — how to fix it. */
export function checkWords(c: Check): { title: string; detail: string } {
  switch (c.check) {
    case 'guard': return c.ok
      ? { title: 'This computer can be locked', detail: 'ExamMode Guard is running on it.' }
      : { title: 'This computer can\'t be locked', detail: 'ExamMode Guard isn\'t running on it. Tell your teacher.' };
    case 'oneScreen': return c.ok
      ? { title: 'One screen', detail: 'A second screen or a projector would stop the exam from starting.' }
      : { title: 'More than one screen', detail: `${c.found ?? 'A second screen'}: unplug the second screen or the projector, then check again.` };
    case 'noRemote': return c.ok
      ? { title: 'No remote-control apps', detail: 'AnyDesk, TeamViewer, Quick Assist and Remote Desktop aren\'t running.' }
      : { title: 'Remote control is on', detail: `${c.found ?? 'A remote-control app'} — close it, then check again.` };
    case 'realComputer': return c.ok
      ? { title: 'A real computer', detail: 'ExamMode isn\'t running inside a virtual machine.' }
      : { title: 'A virtual machine', detail: `This is ${c.found ?? 'a virtual machine'}. An exam is taken on the lab computer itself.` };
  }
}

/** Why a computer can't start, for the teacher's list (12). */
export const WHY_NOT: Record<CheckName, string> = {
  guard: 'ExamMode Guard isn\'t running',
  oneScreen: 'a second screen is plugged in',
  noRemote: 'remote control is on',
  realComputer: 'it is a virtual machine',
};
