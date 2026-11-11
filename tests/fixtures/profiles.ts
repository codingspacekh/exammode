import { appProfile, type AppProfile } from '@lib/profiles/schema';

/** Profiles for the rules' tests, as profiles/*.json will hold them (architecture §2.10; the real ones come in M5). */
export const vscodeJson = {
  id: 'vscode',
  name: 'VS Code',
  match: { files: ['Code.exe'], signer: 'Microsoft Corporation', paths: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code', '%ProgramFiles%\\Microsoft VS Code'] },
  launch: { args: ['--user-data-dir', '{examProfile}/data', '--extensions-dir', '{examProfile}/ext', '{examFolder}'] },
  prepare: [{ copyExtensions: ['ms-python.python'] }, { settings: { 'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false, 'chat.disableAIFeatures': true } }],
  policies: [],
  children: { allow: ['python.exe', 'py.exe', 'conhost.exe', 'powershell.exe', 'cmd.exe'], never: ['browser'] },
  save: 'none',
};

export const wordJson = {
  id: 'word',
  name: 'Word',
  match: { files: ['WINWORD.EXE'], signer: 'Microsoft Corporation', paths: ['%ProgramFiles%\\Microsoft Office', '%ProgramFiles(x86)%\\Microsoft Office'] },
  policies: [
    { hive: 'user', key: 'Software\\Policies\\Microsoft\\Office\\16.0\\Common\\Privacy', name: 'DisconnectedState', value: 2 },
    { hive: 'user', key: 'Software\\Policies\\Microsoft\\Office\\16.0\\Common\\SignIn', name: 'SignInOptions', value: 3 },
  ],
  children: { allow: ['splwow64.exe'], never: ['browser'] },
  save: 'office',
};

export const vscode: AppProfile = appProfile.parse(vscodeJson);
export const word: AppProfile = appProfile.parse(wordJson);
