/**
 * The process guard's lists (architecture §2.5): data, not code. To add a background app that is always closed, or
 * a Windows process that may keep a window, add it here with its test.
 */

/** Programs known by their file name or, since a file can be renamed, by their ProductName. */
export interface NameList { files: string[]; products: string[] }

export interface SystemList {
  /** Windows' own processes that may keep a window: in %SystemRoot%, signed by `signer`, and either one of
   *  `files` or inside one of `folders` (relative to %SystemRoot%). */
  system: { signer: string; files: string[]; folders: string[] };
  browsers: NameList;
  /** always closed, window or not */
  remote: NameList;
  ai: NameList;
  recorders: NameList;
}

export const LISTS: SystemList = {
  // From the M0 recordings. Windows' own apps that are a way out — Explorer, Search, Start, Settings, Widgets,
  // Notepad, Task Manager, the consoles — are not here, so their windows are closed.
  system: {
    signer: 'Microsoft Windows',
    files: [
      'dwm.exe', 'ctfmon.exe', 'TextInputHost.exe', 'ShellExperienceHost.exe', 'fontdrvhost.exe', 'csrss.exe',
      'winlogon.exe', 'LogonUI.exe', 'LockApp.exe', 'sihost.exe', 'svchost.exe', 'taskhostw.exe', 'RuntimeBroker.exe',
      'dllhost.exe', 'TabTip.exe',
    ],
    // the input methods (IME) for Khmer, Chinese, Japanese, Korean …
    folders: ['System32\\InputMethod', 'System32\\IME', 'IME'],
  },
  browsers: {
    files: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'iexplore.exe', 'msedgewebview2.exe', 'arc.exe', 'tor.exe'],
    products: ['Google Chrome', 'Microsoft Edge', 'Firefox', 'Brave Browser', 'Opera Internet Browser', 'Vivaldi', 'Internet Explorer', 'Microsoft Edge WebView2', 'Chromium', 'Tor Browser'],
  },
  remote: {
    files: [
      'AnyDesk.exe', 'TeamViewer.exe', 'TeamViewer_Service.exe', 'rustdesk.exe', 'QuickAssist.exe', 'msra.exe', 'mstsc.exe',
      'remoting_host.exe', 'winvnc.exe', 'vncserver.exe', 'tvnserver.exe', 'UltraVNC.exe', 'parsecd.exe', 'SupremoService.exe',
    ],
    products: ['AnyDesk', 'TeamViewer', 'RustDesk', 'Quick Assist', 'Chrome Remote Desktop', 'TightVNC', 'UltraVNC', 'RealVNC', 'Parsec', 'Supremo'],
  },
  ai: {
    files: ['ollama.exe', 'ollama app.exe', 'LM Studio.exe', 'lms.exe', 'Jan.exe', 'gpt4all.exe', 'koboldcpp.exe', 'llama-server.exe'],
    products: ['Ollama', 'LM Studio', 'Jan', 'GPT4All'],
  },
  recorders: {
    files: ['obs64.exe', 'obs32.exe', 'bdcam.exe', 'ShareX.exe', 'CamtasiaStudio.exe', 'CamRecorder.exe', 'ScreenRec.exe'],
    products: ['OBS Studio', 'Bandicam', 'ShareX', 'Camtasia'],
  },
};
