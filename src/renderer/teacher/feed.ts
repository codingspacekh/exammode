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
