/**
 * A student's exam on a lab computer, without its screens (architecture §2.3, §2.9): the session with the teacher's
 * laptop, the Exam folder, a backup every 2 minutes (F-22), and the hand-in with its receipt (F-16) — by the
 * button, at time up (F-17), or when the teacher ends the exam (F-41).
 */
import { receiptCode } from '@lib/files/receipt';
import { fromTeacher, type FromTeacher } from '@lib/protocol/messages';
import { ExamFiles, sendFiles, uploadOf } from './files';
import type { Session } from './session';

export type Receipt = Extract<FromTeacher, { type: 'receipt' }>;

export interface ExamOptions {
  /** the Exam folder */
  folder: string;
  backupMs?: number;
  retryMs?: number;
  graceMs?: number;
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
  private readonly listeners = new Set<(e: ExamEvent) => void>();

  constructor(readonly session: Session, private readonly options: ExamOptions) {
    this.files = new ExamFiles(options.folder);
    session.on((e) => {
      if (e.type === 'state' && e.state === 'inExam') void this.begin();
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
      if (!this.over) this.timer = setInterval(() => void this.backUp(), this.options.backupMs ?? BACKUP_MS);
    });
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
   *  couldn't take them now (they go with the next one). */
  backUp(): Promise<number> {
    return this.inTurn(async () => {
      const token = this.session.token;
      if (!this.begun || this.over || !token) return -1;
      await this.begun;
      await this.fetchGiven();
      const { files, sent } = await this.files.toBackUp();
      if (files.length === 0) return 0;
      const result = await this.send('backup', token, files);
      if (!result?.ok) return -1;
      sent();
      this.emit({ type: 'backedUp', files: files.length });
      return files.length;
    });
  }

  /** Hands in, and keeps trying until the teacher's laptop has answered: with no contact, when it returns (F-19).
   *  Then the Exam folder is removed (F-21). Answers with the receipt; nothing if the hand-in was refused. */
  handIn(): Promise<Receipt | undefined> {
    this.handingIn ??= this.inTurn(async () => {
      await this.begin();
      clearInterval(this.timer);
      for (;;) {
        const token = this.session.token;
        if (this.over || !token) return undefined;
        const files = await this.files.toHandIn();
        const result = await this.send('handIn', token, files);
        if (result?.ok) {
          const receipt = fromTeacher.safeParse(result.body);
          const { runId, studentId } = this.session.seat;
          if (receipt.success && receipt.data.type === 'receipt' && receipt.data.code === await receiptCode(runId, studentId, files)) {
            return this.finished(receipt.data);
          }
        } else if (result?.status === 401 || result?.status === 409) {
          // no longer in the exam for the teacher's laptop (left, or kept out)
          this.emit({ type: 'handInRefused' });
          return undefined;
        }
        await new Promise((r) => setTimeout(r, this.options.retryMs ?? 2000));
      }
    });
    return this.handingIn;
  }

  /** Leave (F-15): the work so far goes to the teacher first, as it is. */
  async leave(): Promise<void> {
    const backedUp = await this.backUp();
    this.stop();
    this.session.leave();
    if (backedUp >= 0) await this.files.remove();
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
    await this.files.remove();
    this.emit({ type: 'handedIn', receipt });
    return receipt;
  }

  private async send(kind: 'backup' | 'handIn', token: string, files: Receipt['files']) {
    return sendFiles(this.session.base, uploadOf(token, kind, files), this.files.folder, this.options.send).catch(() => undefined);
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
