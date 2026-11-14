import type { FeedItem } from '@lib/app/state';
import type { Tone } from '@/components/brand';

/** A line of *What's happening* (13) in words, with the colour of its mark. Nothing: not worth a line. */
export function feedLine(item: FeedItem): { tone: Tone; who?: string; text: string } | undefined {
  const who = item.student;
  const d = item.details;
  const on = item.pc ? ` on ${item.pc}` : '';
  const host = (): string => {
    try {
      return new URL(String(d.url)).host;
    } catch {
      return String(d.url ?? 'a website');
    }
  };
  switch (item.kind) {
    case 'runStarted': return { tone: 'ok', text: 'The exam started' };
    case 'runEnded': return { tone: 'done', text: 'You ended the exam' };
    case 'timeAdded': return { tone: 'done', who, text: `${who ? '— ' : ''}${String(d.minutes)} minutes added${who ? '' : ' for everyone'}` };
    case 'joinedLate': return { tone: 'ok', who, text: `joined late${on}` };
    case 'handedIn': return { tone: 'done', who, text: d.how === 'handIn' ? 'handed in' : d.how === 'timeUp' ? 'was handed in when the time ran out' : 'was handed in when you ended the exam' };
    case 'left': return { tone: 'danger', who, text: `left — pressed Leave${on}` };
    case 'stoppedSuddenly': return { tone: 'danger', who, text: `left — ExamMode stopped suddenly${on}${d.restarted ? '; the computer was restarted' : ''}` };
    case 'asksBack': return { tone: 'danger', who, text: `asks to come back in${on}` };
    case 'letBackIn': return { tone: 'ok', who, text: 'was let back in' };
    case 'cameBack': return { tone: 'ok', who, text: `is back in the exam${on}` };
    case 'keptOut': return { tone: 'danger', who, text: 'was kept out' };
    case 'noContact': return { tone: 'lost', who, text: `— no contact${item.pc ? ` with ${item.pc}` : ''}` };
    case 'gap': return { tone: 'lost', who, text: `is back in contact after ${String(d.seconds)} s` };
    case 'appClosed': return { tone: 'warn', who, text: `opened ${String(d.app ?? 'an app that isn\'t allowed')} — closed` };
    case 'pageBlocked': return { tone: 'lost', who, text: `clicked a site that isn't allowed — ${host()}` };
    case 'displayAdded': return { tone: 'warn', who, text: 'plugged in a second screen' };
    case 'checkFailed': return { tone: 'warn', who, text: `— this computer can't start: ${String(d.check)}` };
    case 'leftBeforeStart': return { tone: 'lost', who, text: 'left before the start' };
    case 'nameTaken': return { tone: 'warn', who, text: `— someone on ${item.pc ?? 'another computer'} picked this name` };
    case 'codeWrong': return { tone: 'lost', text: `A wrong code was typed${on}` };
    default: return undefined;
  }
}

/** A line of a student's own timeline (13b): what happened, and a second line where it helps. */
export function timelineLine(item: FeedItem): { tone: Tone; title: string; detail?: string } {
  const d = item.details;
  const on = item.pc ? ` on ${item.pc}` : '';
  switch (item.kind) {
    case 'joined': return { tone: 'ok', title: `Joined${on}` };
    case 'ready': return { tone: 'ok', title: 'Ready: the computer passed its checks' };
    case 'started': return { tone: 'ok', title: 'Exam started' };
    case 'joinedLate': return { tone: 'ok', title: 'Started late, with the time that was left' };
    case 'left': return { tone: 'danger', title: 'Pressed Leave', detail: 'Confirmed on the Leave screen. The work so far was collected as it was.' };
    case 'stoppedSuddenly': return {
      tone: 'danger', title: 'ExamMode stopped suddenly',
      detail: d.restarted ? 'The computer was restarted.' : `No goodbye${item.pc ? ` from ${item.pc}` : ''} — closed from Task Manager or it crashed.`,
    };
    case 'asksBack': return { tone: 'danger', title: `Asked to come back in${on}`, detail: 'Refused — waiting for you' };
    case 'letBackIn': return { tone: 'ok', title: 'You let them back in', detail: d.reason ? `Reason: ${String(d.reason)}` : undefined };
    case 'keptOut': return { tone: 'danger', title: 'You kept them out', detail: d.reason ? `Reason: ${String(d.reason)}` : undefined };
    case 'cameBack': return { tone: 'ok', title: `Back in the exam${on}`, detail: `Out of the exam for ${Math.max(1, Math.round(Number(d.secondsOut ?? 0) / 60))} min` };
    case 'noContact': return { tone: 'lost', title: 'No contact', detail: 'The computer couldn\'t be reached. Not leaving: it stays as it is.' };
    case 'gap': return { tone: 'lost', title: `Back in contact after ${String(d.seconds)} s`, detail: Array.isArray(d.localLog) && d.localLog.length > 1 ? `${d.localLog.length - 1} things happened meanwhile, reported by the computer` : undefined };
    case 'timeAdded': return { tone: 'done', title: `${String(d.minutes)} minutes added` };
    case 'handedIn': return { tone: 'done', title: d.how === 'handIn' ? 'Handed in' : d.how === 'timeUp' ? 'Handed in when the time ran out' : 'Handed in when you ended the exam' };
    default: {
      const line = feedLine(item);
      const text = line?.text.replace(/^— /, '') ?? item.kind;
      return { tone: line?.tone ?? 'wait', title: text.charAt(0).toUpperCase() + text.slice(1) };
    }
  }
}
