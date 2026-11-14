/**
 * Trust, for this ExamMode as it runs (F-44, architecture §2.12): whose licences it believes, and where the
 * teacher's own key is kept. An installed ExamMode believes the author's keys and nothing else; a development
 * build also takes a teacher with no licence (unless `EXAMMODE_REQUIRE_LICENCE=1`) and can be given a test's own
 * author (`EXAMMODE_AUTHOR_KEYS`).
 */
import { app, safeStorage } from 'electron';
import { trustOf } from '@lib/trust/author';
import type { Trust } from '@lib/trust/licence';
import { PLAIN, TeacherLicence, type Vault } from '../teacher/licence';

export function trust(env: NodeJS.ProcessEnv = process.env): Trust {
  return trustOf(app.isPackaged, env.EXAMMODE_AUTHOR_KEYS?.split(',').filter(Boolean), env.EXAMMODE_REQUIRE_LICENCE === '1');
}

/** The system's keychain: what it seals, only this account on this computer opens. */
const keychain: Vault = {
  seal: (secret) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no keychain to keep a teacher key in.');
    return safeStorage.encryptString(secret).toString('base64');
  },
  open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
};

export function teacherLicence(env: NodeJS.ProcessEnv = process.env): TeacherLicence {
  // (a test's own settings folder isn't worth the keychain asking for a password)
  const vault = !app.isPackaged && env.EXAMMODE_USER_DATA ? PLAIN : keychain;
  return new TeacherLicence(app.getPath('userData'), trust(env), vault);
}
