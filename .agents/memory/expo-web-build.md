---
name: Expo web build gotcha
description: How to reliably build/deploy the web bundle for the BSNL app despite the build tool reporting false failures.
---

# Building & deploying the web bundle

The app serves a static prebuilt bundle from `dist/` (via `bun run server.ts`).
**Source edits to any frontend file are invisible until you rebuild `dist/` AND
restart the `BSNL App` workflow.** Backend-only edits (e.g. `backend/**`,
`server.ts`) take effect on workflow restart alone — no rebuild needed.

## The build command
`bunx expo export --platform web --output-dir dist`

**Why:** the bash tool frequently reports the command as failed — `exit code -1`
(killed early, no output) or `exit code 124` (timeout) — **even though the build
actually finished successfully.** The export takes ~2-3 min and prints
`Exported: dist` at the very end.

## How to apply (verify success despite a "failed" tool result)
1. Don't trust the exit code. Instead tee output to a file and check it:
   `(bunx expo export --platform web --output-dir dist 2>&1 | tee /tmp/build.log; echo "EXIT:${PIPESTATUS[0]}" >> /tmp/build.log) | tail -4`
2. Confirm success two ways: `grep "Exported: dist" /tmp/build.log` AND
   `ls -la --time-style=+%H:%M:%S dist/_expo/static/js/web/*.js` — the bundle's
   timestamp must be newer than your edit (compare against `date`).
3. A no-op source change (e.g. removing an unused variable) can produce an
   identical bundle hash — that's expected, not a failed build.
4. Detached/background builds (`nohup ... &`) get reaped by the sandbox when the
   bash call returns — don't rely on them. Run in the foreground with a generous
   timeout and verify via the timestamp afterward.
5. After a confirmed build, `restart_workflow("BSNL App")` to serve it.
