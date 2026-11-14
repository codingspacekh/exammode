/*
 * Makes the prototype's screens clickable without changing how they look.
 *
 * Each screen has a short list of rules: [selector, text it contains (or null), event, screen to open].
 *  - Opened on its own, a click opens the next screen.
 *  - Opened inside play.html (?play=1), the click is told to the player, which decides what the teacher's laptop
 *    and the lab computer show next.
 * A few clicks only change the screen itself: choosing an exam, typing the code, ticking "I understand".
 */
(() => {
  const screen = location.pathname.split('/').pop().replace('.html', '');
  const params = new URLSearchParams(location.search);
  const inPlayer = params.has('play') && window.parent !== window;

  const BAR = [
    ['.xtab', 'Questions', 'tab:04-exam-questions', '04-exam-questions'],
    ['.xtab', 'Word', 'tab:05-exam-word', '05-exam-word'],
    ['.xtab', 'VS Code', 'tab:06-exam-vscode', '06-exam-vscode'],
    ['.xbtn.primary', 'Hand in', 'handin', '09-hand-in'],
    ['.xbtn.icon', null, 'more', '08-leave'],
  ];
  const RULES = {
    '01-join': [['.exam-opt', null, '@pick'], ['.code-boxes', null, '@code'], ['.btn.primary', 'Join', 'join', '02-checks']],
    '02-checks': [['.btn.ghost', 'Back', 'back', '01-join'], ['.btn.primary', 'continue', 'continue', '03-waiting']],
    '03-waiting': [['.pulse', null, 'waiting', '04-exam-questions']],
    '04-exam-questions': BAR,
    '05-exam-word': BAR,
    '06-exam-vscode': BAR,
    '07-app-closed': [['.toast', null, 'dismiss', '05-exam-word'], ...BAR],
    '07b-page-blocked': [['.btn.primary', 'Back to the questions', 'tab:04-exam-questions', '04-exam-questions'], ...BAR],
    '08-leave': [['.check', null, '@tick'], ['.btn.danger', 'Leave', 'left', '10-cant-rejoin'], ['.btn.primary', 'Stay', 'stay', '05-exam-word']],
    '09-hand-in': [['.btn.primary', 'Hand in now', 'handnow', '09b-handed-in'], ['.btn', 'Keep working', 'stay', '05-exam-word']],
    '09b-handed-in': [['.btn.primary', 'Finish', 'finish', '01-join']],
    '10-cant-rejoin': [['.btn.ghost', 'Close', 'close', '01-join']],
    '10b-connection-lost': [['.banner', null, 'plug', '05-exam-word'], ...BAR],
    '11-make-exam': [['.btn.primary', 'Open for students', 'open', '12-lobby'], ['.appopt.add', null, 'addapp', '11b-add-app']],
    '11b-add-app': [['.dialog .btn', 'Cancel', 'addapp-close', '11-make-exam'], ['.dialog .btn.primary', 'Add', 'addapp-close', '11-make-exam'], ['.btn.primary', 'Open for students', 'open', '12-lobby']],
    '12-lobby': [['.btn.ok', 'Start the exam', 'start', '13-dashboard']],
    '13-dashboard': [['.scard.left', null, 'look', '13b-student'], ['.btn.primary', 'Look', 'look', '13b-student'], ['.btn', 'End the exam', 'end', '14-end'], ['.btn', 'Add time', 'addtime']],
    '13b-student': [['.btn.primary', 'Let back in', 'letin', '13-dashboard'], ['.btn', 'Keep out', 'keepout', '13-dashboard'], ['.btn', 'End the exam', 'end', '14-end'], ['.btn', 'Add time', 'addtime']],
    '14-end': [['.tnav a', 'Exams', 'exams', '11-make-exam']],
  };
  const rules = RULES[screen] || [];

  const matches = (el, [selector, text]) => el.matches(selector) && (!text || el.textContent.includes(text));
  /** The rule for a click: the nearest element, going up from where it landed, that a rule names. */
  function ruleFor(target) {
    for (let el = target; el && el !== document.body; el = el.parentElement) {
      const rule = rules.find((r) => matches(el, r));
      if (rule) return { el, rule };
    }
    return null;
  }

  // ── clicks that only change this screen ──────────────────────────────────────────────────────────────────────
  const LOCAL = {
    '@pick'(el) {
      for (const opt of document.querySelectorAll('.exam-opt')) {
        opt.classList.toggle('on', opt === el);
        opt.querySelector('.radio')?.classList.toggle('on', opt === el);
      }
    },
    /** The last digit of the code on the board: with it, Join can be pressed. */
    '@code'() {
      const last = document.querySelector('.code-boxes .empty');
      if (!last) return;
      last.textContent = '7';
      last.classList.remove('empty', 'on');
      document.querySelector('.btn.primary[disabled]')?.removeAttribute('disabled');
    },
    '@tick'(el) {
      el.classList.add('on');
      Object.assign(el.style, { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: '11px' });
      el.textContent = '✓';
      document.querySelector('.btn.danger[disabled]')?.removeAttribute('disabled');
    },
  };

  document.addEventListener('click', (e) => {
    const hit = ruleFor(e.target);
    if (!hit || hit.el.closest('[disabled]')) return;
    const [, , event, next] = hit.rule;
    if (LOCAL[event]) return LOCAL[event](hit.el);
    e.preventDefault();
    if (inPlayer) window.parent.postMessage({ proto: true, screen, event }, '*');
    else if (next) location.href = `${next}.html`;
  });
  // typing a digit on the join screen is typing the code
  document.addEventListener('keydown', (e) => {
    if (screen === '01-join' && /^\d$/.test(e.key)) LOCAL['@code']();
  });

  // ── the story's own details, when the player asks for them (?as=…) ───────────────────────────────────────────
  // The screens were drawn with Vannak as the student who is locked out. In the player it is the student at the
  // lab computer, Sokha: the two swap places, so the teacher's laptop and the lab computer tell one story.
  const SWAP = [['Vannak Sok', 'Sokha Chan'], ['Vannak', 'Sokha'], ['PC-07', 'PC-14']];
  const MOVED = [['PC-14 → PC-02', 'PC-14'], ['on PC-02', 'on PC-14']];
  const AS = {
    // on the lab computer (screen 10)
    killed: [['Vannak Sok', 'Sokha Chan'], ['PC-02 · ICT Lab 2', 'PC-14 · ICT Lab 2'], ['09:58 on PC-07', '09:58 on this computer']],
    left: [['Vannak Sok', 'Sokha Chan'], ['PC-02 · ICT Lab 2', 'PC-14 · ICT Lab 2'], ['09:58 on PC-07', '09:58 on this computer'], ['ExamMode stopped suddenly', 'You pressed Leave']],
    // on the teacher's laptop (13, 13b)
    'teacher-killed': MOVED,
    'teacher-left': [
      ...MOVED, ['ExamMode stopped suddenly on PC-14', 'pressed Leave on PC-14'], ['ExamMode stopped suddenly', 'Pressed Leave'],
      ['No goodbye from PC-14 — closed from Task Manager or it crashed. The computer stayed switched on.', 'Confirmed on the Leave screen: ticked "I understand I can\'t come back".'],
      ['The computer crashed', 'Pressed Leave by mistake'],
    ],
  };
  function rewrite(pairs, swap) {
    const walker = document.createTreeWalker(document.querySelector('.frame'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue;
      if (swap) {
        // a ↔ b, through a stand-in so the second step doesn't undo the first
        SWAP.forEach(([a, b], i) => { text = text.replaceAll(a, `\u0000${i}a`).replaceAll(b, `\u0000${i}b`); });
        SWAP.forEach(([a, b], i) => { text = text.replaceAll(`\u0000${i}a`, b).replaceAll(`\u0000${i}b`, a); });
      }
      for (const [from, to] of pairs) text = text.replaceAll(from, to);
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  }
  const as = params.get('as');
  if (as && AS[as]) {
    rewrite(AS[as], as.startsWith('teacher-'));
    // the initials on the student's panel (13b)
    for (const avatar of document.querySelectorAll('.sp-h .avatar')) if (avatar.textContent === 'VS') avatar.textContent = 'SC';
  }

  // ── inside the player: the screen fills its frame; what can be clicked can be shown ───────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .proto-hot { cursor: pointer; }
    body.proto-show .proto-hot { outline: 2px solid #f59e0b; outline-offset: 2px; border-radius: 6px; animation: proto-pulse 1.2s ease-in-out infinite; }
    @keyframes proto-pulse { 50% { outline-color: rgba(245, 158, 11, .25); } }
    @media (prefers-reduced-motion: reduce) { body.proto-show .proto-hot { animation: none; } }
    body.proto-play { padding: 0; background: var(--bg); }
    body.proto-play .frame-label { display: none; }
    body.proto-play .frame { width: 100vw; height: 100vh; border-radius: 0; box-shadow: none; }
  `;
  document.head.append(style);
  const mark = () => {
    for (const el of document.querySelectorAll('.frame *')) if (rules.some((r) => matches(el, r))) el.classList.add('proto-hot');
  };
  const ready = () => {
    document.body.classList.toggle('proto-play', inPlayer);
    document.body.classList.toggle('proto-show', params.has('show'));
    mark();
  };
  if (document.body) ready();
  else document.addEventListener('DOMContentLoaded', ready);
  window.addEventListener('message', (e) => {
    if (e.data && e.data.protoShow !== undefined) document.body.classList.toggle('proto-show', e.data.protoShow);
  });
  // H shows what can be clicked, on a screen opened by itself
  document.addEventListener('keydown', (e) => {
    if (!inPlayer && e.key.toLowerCase() === 'h') document.body.classList.toggle('proto-show');
  });
})();
