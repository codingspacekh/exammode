/**
 * A student's exam on a lab computer, without its screens (architecture §2.3, §2.9): the session with the teacher's
 * laptop, the Exam folder, a backup every 2 minutes (F-22), and the hand-in with its receipt (F-16) — by the
 * button, at time up (F-17), or when the teacher ends the exam (F-41).
 */
import { receiptCode } from '@lib/files/receipt';
import { fromTeacher, type FileMeta, type FromTeacher } from '@lib/protocol/messages';
import { checkUpload } from '../../trust/signed';
import { ExamFiles, batches, sendFiles, uploadOf } from './files';
import type { Session } from './session';

export type Receipt = Extract<FromTeacher, { type: 'receipt' }>;

export interface ExamOptions {
  /** the Exam folder */
  folder: string;
  backupMs?: number;
  retryMs?: number;
  /** the longest wait between two tries of the hand-in */
  retryMaxMs?: number;
  graceMs?: number;
  /** closes the exam's apps: one that is open in the Exam folder keeps Windows from removing it */
  closeApps?: () => Promise<void>;
  /** sends the files; a test can stand in for the network here */
  send?: typeof fetch;
}

export type ExamEvent = { type: 'backedUp'; files: number } | { type: 'handedIn'; receipt: Receipt } | { type: 'handInRefused' };

export const BACKUP_MS = 120_000;
/** How long ExamMode waits, at time up by its own count, for the teacher's laptop to say so too. */
export const GRACE_MS = 5000;

export class StudentExam {
  readonly files: ExamFiles;
  receipt?: Receipt;
  private begun?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private grace?: NodeJS.Timeout;
  private handingIn?: Promise<Receipt | undefined>;
  private busy: Promise<unknown> = Promise.resolve();
  private over = false;
  private readonly toldTooBig = new Set<string>();
  private readonly listeners = new Set<(e: ExamEvent) => void>();

  constructor(readonly session: Session, private readonly options: ExamOptions) {
    this.files = new ExamFiles(options.folder);
    session.on((e) => {
      if (e.type === 'state' && e.state === 'inExam') void this.begin().catch(() => undefined);
      if (e.type === 'end') void this.handIn();
      // by this computer's own count the time is up: the teacher's laptop says so a moment before or after, and
      // its word is the one that counts (D5). With no contact, or if it stays silent, hand in anyway
      if (e.type === 'timeUp') this.grace = setTimeout(() => void this.handIn(), session.state === 'inExam' ? options.graceMs ?? GRACE_MS : 0);
      if (e.type === 'state' && (e.state === 'refused' || e.state === 'closed')) this.stop();
    });
  }

  on(listener: (e: ExamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** In the exam: the Exam folder is there, and the backups begin. */
  begin(): Promise<void> {
    this.begun ??= this.files.begin().then(() => this.fetchGiven()).then(() => {
      if (!this.over) this.timer = setInterval(() => void this.backUp().catch(() => undefined), this.options.backupMs ?? BACKUP_MS);
    });
    // (a folder that couldn't be made is tried again the next time, not remembered as failed for the whole exam)
    this.begun.catch(() => void (this.begun = undefined));
    return this.begun;
  }

  /** The teacher's files into the Exam folder (F-33). What couldn't be fetched now is tried again later. */
  private async fetchGiven(): Promise<void> {
    const { token, exam, base, seat } = this.session;
    if (!token || !exam?.files?.length) return;
    const send = this.options.send ?? fetch;
    await this.files.give(exam.files, (name) => send(`${base}/runs/${encodeURIComponent(seat.runId)}/files/${encodeURIComponent(name)}`, { headers: { 'x-exammode-token': token } }));
  }

  /** Sends the files that changed since the last backup. Answers how many went; -1 if the teacher's laptop
   *  couldn't take them all now (the rest go with the next one). */
  backUp(): Promise<number> {
    return this.inTurn(async () => {
      const token = this.session.token;
      if (!this.begun || this.over || !token) return -1;
      await this.begun;
      await this.fetchGiven();
      return (await this.sendChanged(token)).sent;
    });
  }

  /** The changed files, in parts (a folder of thousands of files isn't one request). What went is remembered as
   *  gone; `answer`: the teacher's laptop's word when it didn't take a part. */
  private async sendChanged(token: string): Promise<{ sent: number; status?: number }> {
    void this.sayTooBig();
    const { files, sent } = await this.files.toBackUp();
    const done: FileMeta[] = [];
    for (const part of batches(files)) {
      const result = await this.send('backup', token, part);
      if (!result?.ok || !this.believed(result.body, token, 'backup', part)) {
        sent(done);
        if (done.length > 0) this.emit({ type: 'backedUp', files: done.length });
        return { sent: -1, status: result && !result.ok ? result.status : undefined };
      }
      done.push(...part);
    }
    sent(done);
    if (done.length > 0) this.emit({ type: 'backedUp', files: done.length });
    return { sent: done.length };
  }

  /** A file that is too big to send is said once, to the teacher: it isn't in the backup or the hand-in. */
  private async sayTooBig(): Promise<void> {
    for (const f of await this.files.tooBig().catch(() => [])) {
      if (this.toldTooBig.has(f.name)) continue;
      this.toldTooBig.add(f.name);
      this.session.report('fileTooBig', { name: f.name, megabytes: Math.round(f.bytes / 1024 / 1024) });
    }
  }

  /** Hands in, and keeps trying until the teacher's laptop has answered: with no contact, when it returns (F-19).
   *  Then the Exam folder is removed (F-21). Answers with the receipt; nothing if the hand-in was refused. */
  handIn(): Promise<Receipt | undefined> {
    this.handingIn ??= this.inTurn(async () => {
      await this.begin().catch(() => undefined);
      clearInterval(this.timer);
      for (let tries = 0; ; tries++) {
        const token = this.session.token;
        if (this.over || !token) return undefined;
        // (a folder that can't be read just now, a network that fails: whatever goes wrong is tried again)
        const result = await this.tryHandIn(token).catch(() => 'again' as const);
        if (result !== 'again') return result === 'refused' ? undefined : result;
        // not at once, and not all the lab's computers at the same moment: the laptop may be busy, or coming back
        const wait = Math.min((this.options.retryMs ?? 2000) * 2 ** Math.min(tries, 4), this.options.retryMaxMs ?? 30_000);
        await new Promise((r) => setTimeout(r, wait * (0.75 + Math.random() / 2)));
      }
    });
    return this.handingIn;
  }

  /** One try: what changed since the last backup goes up first, in parts; then the hand-in itself is the list of
   *  every file — the teacher's laptop has them all by then. */
  private async tryHandIn(token: string): Promise<Receipt | 'again' | 'refused'> {
    const backedUp = await this.sendChanged(token);
    // (409: no more backups are taken — handed in already and the receipt was lost, or no longer in the exam: the
    // hand-in's own answer says which)
    if (backedUp.sent < 0 && backedUp.status !== 409) return backedUp.status === 401 ? this.refusedByTeacher() : 'again';
    const files = await this.files.toHandIn();
    const result = await this.send('handIn', token, files, []);
    if (result?.ok && this.believed(result.body, token, 'handIn', files)) {
      const receipt = fromTeacher.safeParse(result.body);
      const { runId, studentId } = this.session.seat;
      if (receipt.success && receipt.data.type === 'receipt' && receipt.data.code === await receiptCode(runId, studentId, files)) return this.finished(receipt.data);
    } else if (result && !result.ok && (result.status === 401 || result.status === 409)) {
      // no longer in the exam for the teacher's laptop (left, or kept out)
      return this.refusedByTeacher();
    } else if (result && !result.ok && result.status === 422) {
      // the laptop doesn't have what this computer thought it had: everything goes again
      this.files.forget();
    }
    return 'again';
  }

  private refusedByTeacher(): 'refused' {
    this.emit({ type: 'handInRefused' });
    return 'refused';
  }

  /** Leave (F-15): the work so far goes to the teacher first, as it is. */
  async leave(): Promise<void> {
    const backedUp = await this.backUp();
    this.stop();
    this.session.leave();
    if (backedUp >= 0) await this.removeFolder();
  }

  /** Stops the backups; a hand-in that is still trying gives up. */
  stop(): void {
    this.over = true;
    clearInterval(this.timer);
    clearTimeout(this.grace);
  }

  private async finished(receipt: Receipt): Promise<Receipt> {
    this.receipt = receipt;
    this.stop();
    this.session.handedIn();
    await this.removeFolder();
    this.emit({ type: 'handedIn', receipt });
    return receipt;
  }

  /** The teacher has the work: the exam's apps are closed, then the Exam folder is removed (F-21). A folder that
   *  Windows still holds doesn't keep the student from Handed in: `removeFolder` is asked again at Finish. */
  async removeFolder(): Promise<void> {
    await this.options.closeApps?.().catch(() => undefined);
    await this.files.remove().catch(() => undefined);
  }

  /** With a licensed teacher, an answer counts only when that teacher's laptop signed it: it has exactly these
   *  files (F-44). Anyone else's "got them" is as good as no answer. */
  private believed(body: unknown, token: string, kind: 'backup' | 'handIn', files: Receipt['files']): boolean {
    const key = this.session.teacherKey;
    return key === undefined || checkUpload((body as { sig?: unknown } | null)?.sig, token, kind, files, key);
  }

  private async send(kind: 'backup' | 'handIn', token: string, files: FileMeta[], attach: FileMeta[] = files) {
    return sendFiles(this.session.base, uploadOf(token, kind, files), this.files.folder, this.options.send, attach).catch(() => undefined);
  }

  /** A backup and the hand-in never read the folder at the same time. */
  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const done = this.busy.then(work);
    this.busy = done.catch(() => undefined);
    return done;
  }

  private emit(e: ExamEvent): void {
    for (const listener of this.listeners) listener(e);
  }
}
