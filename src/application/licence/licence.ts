/**
 * The teacher's own key and licence on their laptop (F-44, architecture §2.12), in ExamMode's settings folder:
 *
 *   teacher-key.json     the key pair made by *I'm a teacher…*; the private half sealed by the system's own
 *                        keychain (the vault), so a copy of the file is no use on another computer or account
 *   teacher.emlicence    the licence the author sent, once it was checked: the author's, and for this key
 *
 * With both, this ExamMode is a teacher's.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { newKeyPair, publicOf } from '@infrastructure/crypto/keys';
import { checkLicence } from '@infrastructure/crypto/licence';
import { request, requestText, type Licence, type LicenceCheck, type Trust } from '@domain/trust/licence';
import type { Identity } from '@infrastructure/crypto/signed';

/** Seals a secret so only this computer's account can open it. */
export interface Vault { seal(secret: string): string; open(sealed: string): string }
/** No sealing: for tests and development, never an installed ExamMode. */
export const PLAIN: Vault = { seal: (secret) => secret, open: (sealed) => sealed };

const stored = z.object({ publicKey: z.string(), sealed: z.string() });
export interface RequestForm { name: string; school: string; email: string; check: string; note?: string }
const WRONG: Record<string, string> = {
  name: 'Type your name.', school: 'Type your school\'s name.', email: 'Type your school email address.',
  check: 'Say where it can be checked that you teach there: your school\'s staff page, say.', note: 'The note is too long.',
};

export class TeacherLicence {
  constructor(private readonly folder: string, private readonly trust: Trust, private readonly vault: Vault = PLAIN) {}

  private get keyFile(): string {
    return join(this.folder, 'teacher-key.json');
  }

  private get licenceFile(): string {
    return join(this.folder, 'teacher.emlicence');
  }

  /** This computer's teacher key, if one was made and can still be opened. */
  private async key(): Promise<{ publicKey: string; privateKey: string } | undefined> {
    try {
      const { publicKey, sealed } = stored.parse(JSON.parse(await readFile(this.keyFile, 'utf8')));
      const privateKey = this.vault.open(sealed);
      return publicOf(privateKey) === publicKey ? { publicKey, privateKey } : undefined;
    } catch {
      return undefined;
    }
  }

  /** The request to send to the author, as text — or what is missing, in words. The key is made the first time
   *  and kept: asking again sends the same key, so a licence that is on its way still fits. */
  async request(form: RequestForm, about: string): Promise<{ text: string } | { error: string }> {
    let keys = await this.key();
    const draft = request.safeParse({ ...form, note: form.note?.trim() || undefined, key: keys?.publicKey ?? newKeyPair().publicKey });
    if (!draft.success) return { error: WRONG[String(draft.error.issues[0]?.path[0])] ?? 'Check what you typed.' };
    if (!keys) {
      keys = newKeyPair();
      await mkdir(this.folder, { recursive: true });
      await writeFile(this.keyFile, JSON.stringify({ publicKey: keys.publicKey, sealed: this.vault.seal(keys.privateKey) }), { mode: 0o600 });
    }
    return { text: requestText({ ...draft.data, key: keys.publicKey }, about) };
  }

  /** A licence file the teacher opened: kept if it is the author's and for this computer's key. */
  async load(path: string): Promise<LicenceCheck | { ok: false; why: 'unreadable' | 'noRequest' }> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return { ok: false, why: 'unreadable' };
    }
    const keys = await this.key();
    // (said before "another computer": on a computer that never asked, that is what is wrong)
    const checked = checkLicence(raw, this.trust, keys?.publicKey);
    if (!keys && (checked.ok || checked.why === 'otherComputer')) return { ok: false, why: 'noRequest' };
    if (checked.ok) await writeFile(this.licenceFile, JSON.stringify(checked.licence, null, 2));
    return checked;
  }

  /** This laptop's licence and key, when it is a teacher's. */
  async identity(): Promise<Identity | undefined> {
    const keys = await this.key();
    if (!keys) return undefined;
    const raw = await readFile(this.licenceFile, 'utf8').then((text) => JSON.parse(text) as unknown, () => undefined);
    const checked = checkLicence(raw, this.trust, keys.publicKey);
    return checked.ok ? { licence: checked.licence, privateKey: keys.privateKey } : undefined;
  }
}

/** A licence, in words, for the screens. */
export const licenceLine = (l: Licence): string => `${l.name} · ${l.school} · licence ${l.id}`;
