/**
 * The kinds of event in a run's log (F-39, F-42): one list. An event is written on one side (the rules, the
 * classroom, a lab computer's report) and put into words on another (the teacher's *What's happening*, the
 * exported log); a kind that is written and has no words is a warning nobody can read — the tests check every
 * kind here has its line.
 */
export const EVENT_KINDS = [
  // the run
  'runOpened', 'runStarted', 'runEnded', 'timeAdded',
  // a student's way through it
  'joined', 'ready', 'started', 'joinedLate', 'handedIn', 'left', 'stoppedSuddenly', 'asksBack', 'letBackIn', 'cameBack', 'keptOut', 'leftBeforeStart',
  // contact
  'noContact', 'gap',
  // what a lab computer reports
  'appClosed', 'appMissing', 'pageBlocked', 'displayAdded', 'ruleChanged', 'fileTooBig',
  // what the teacher's laptop notices
  'checkFailed', 'nameTaken', 'codeWrong', 'uploadFailed',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** What a lab computer's ExamMode may report by itself. */
export type ReportKind = Extract<EventKind, 'appClosed' | 'appMissing' | 'pageBlocked' | 'displayAdded' | 'ruleChanged' | 'fileTooBig'>;

/** Not worth a line in *What's happening*: the lobby's list and the cards show them. */
export const QUIET: readonly EventKind[] = ['runOpened', 'joined', 'ready', 'started'];
