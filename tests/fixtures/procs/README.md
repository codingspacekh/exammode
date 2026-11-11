# Recorded process lists

One record per process, as `spikes/windows/record-fixtures.mjs` writes them: `pid`, `parentPid`, `name`, `image` (the
full path; `null` for a protected process), `signer` (the certificate's subject), `signature` (`Valid`, `NotSigned` …),
`product`, `hasWindow`.

| File | From |
|---|---|
| `windows-server-2022-idle.json`, `windows-server-2025-idle.json` | **recorded** by the M0 spike on GitHub's runners (Windows 10's and 11's code bases), 2026-11-10 |
| `lab-by-hand.json` | **written by hand** in the same shape — Office, VS Code running Python, Chrome, AnyDesk — until the lab computers' own recordings replace it (MILESTONES §3.1, M0's gate) |
