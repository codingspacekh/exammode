import { contextBridge } from 'electron';

/** The renderer's only way to the system (architecture §2.2). Grows with each milestone. */
contextBridge.exposeInMainWorld('exammode', {
  platform: process.platform,
});
