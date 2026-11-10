# M0 Windows spike

Throw-away code (MILESTONES T10) that answers R1 before anything is built on it: can ExamMode, from Node and
Electron through koffi, swallow the Windows key, see and close new windows within a second, reserve the top of the
screen for the exam bar, stop and restart Explorer, change the firewall and policies, and put everything back?

## Run it on a lab computer

1. Install [Node.js 24](https://nodejs.org) and [Git](https://git-scm.com).
2. Open **PowerShell as administrator** (right-click → *Run as administrator*):
   ```powershell
   git clone https://github.com/codingspacekh/exammode
   cd exammode
   npm ci
   node spikes/windows/run-all.mjs --long
   ```
3. Leave the computer alone while it runs (about 35 minutes). The taskbar disappears for a few seconds and comes
   back; Notepad and Task Manager open and close by themselves. Everything it changes is put back.
4. Send back the files in `spikes/windows/out/`.

Without `--long` it takes about 3 minutes. GitHub runs the short version on Windows Server 2022 and 2025 (the
*spike* workflow); its reports are in each run's artifacts.
