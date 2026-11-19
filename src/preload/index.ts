import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CALLS, channel, type ApiOf, type Side, type StateOf } from '@contracts/ipc/calls';
import { VIEWS, type ExamModeApi, type View } from '@contracts/ipc/api';

/**
 * The renderer's only way to the system (architecture §2.2): `window.exammode`, shaped as ExamModeApi
 * (src/contracts/ipc). Each side is a state to show and a few things to ask for; the main process only answers the
 * ones that belong to the mode it runs in.
 */
function side<S extends Side>(name: S): ApiOf[S] {
  type State = StateOf<ApiOf[S]>;
  const api: Record<string, unknown> = {
    get: () => ipcRenderer.invoke(channel.get(name)),
    onState: (listener: (state: State) => void) => {
      const heard = (_event: IpcRendererEvent, state: State): void => listener(state);
      ipcRenderer.on(channel.state(name), heard);
      return () => void ipcRenderer.removeListener(channel.state(name), heard);
    },
  };
  for (const call of CALLS[name]) api[call] = (...args: unknown[]) => ipcRenderer.invoke(channel.call(name, call), ...args);
  // (every call of the API is on CALLS' list: calls.ts checks that it compiles)
  return api as unknown as ApiOf[S];
}

const asked = new URLSearchParams(location.search).get('view');
const exammode = {
  platform: process.platform,
  view: VIEWS.find((v) => v === asked) ?? ('student' satisfies View),
  student: side('student'),
  teacher: side('teacher'),
  browser: side('browser'),
} satisfies ExamModeApi;

contextBridge.exposeInMainWorld('exammode', exammode);
