import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { BROWSER_CALLS, STUDENT_CALLS, TEACHER_CALLS } from '@contracts/ipc/calls';

/**
 * The renderer's only way to the system (architecture §2.2): `window.exammode`, shaped as ExamModeApi
 * (src/contracts/ipc/state.ts). Each side is a state to show and a few things to ask for; the main process only answers
 * the ones that belong to the mode it runs in.
 */
function side(name: string, calls: readonly string[]): Record<string, unknown> {
  const api: Record<string, unknown> = {
    get: () => ipcRenderer.invoke(`${name}:get`),
    onState: (listener: (state: unknown) => void) => {
      const heard = (_event: IpcRendererEvent, state: unknown): void => listener(state);
      ipcRenderer.on(`${name}:state`, heard);
      return () => void ipcRenderer.removeListener(`${name}:state`, heard);
    },
  };
  for (const call of calls) api[call] = (...args: unknown[]) => ipcRenderer.invoke(`${name}:${call}`, ...args);
  return api;
}

contextBridge.exposeInMainWorld('exammode', {
  platform: process.platform,
  view: new URLSearchParams(location.search).get('view') ?? 'student',
  student: side('student', STUDENT_CALLS),
  teacher: side('teacher', TEACHER_CALLS),
  browser: side('browser', BROWSER_CALLS),
});
