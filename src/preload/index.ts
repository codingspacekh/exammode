import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * The renderer's only way to the system (architecture §2.2): `window.exammode`, shaped as ExamModeApi
 * (src/lib/app/state.ts). Each side is a state to show and a few things to ask for; the main process only answers
 * the ones that belong to the mode it runs in.
 */
function side(name: string, calls: string[]): Record<string, unknown> {
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
  student: side('student', ['pick', 'lookAt', 'join', 'checkAgain', 'lock', 'backOut', 'askHandIn', 'keepWorking', 'handIn', 'askLeave', 'leave', 'giveUp', 'finish', 'showQuestions', 'openFolder']),
  teacher: side('teacher', ['open', 'saveExam', 'openSaved', 'copyExam', 'deleteExam', 'chooseFiles', 'saveClass', 'deleteClass', 'readListFile', 'start', 'end', 'letBackIn', 'keepOut', 'addTime', 'done', 'openFolder', 'exportLog']),
  browser: side('browser', ['select', 'close', 'back', 'forward', 'reload', 'toQuestions']),
});
