# Making Chomugiri work the way Claude Code does: brief, findings, plan

Kept in the manner of Craft Anything's investigation notes (brief, findings with evidence, plan, unknowns, handoff), so the next
session continues from here instead of starting over.

## Brief
- **Question.** Why does Chomugiri not feel like Claude Code, and what closes the gap?
- **Clean room.** Claude Code is Anthropic's product. Nothing inside it is read, decompiled or copied. The target is what its
  public documentation and its visible behaviour show (a prompt line, tool lines with results, approval before changes, a task
  list, resumable sessions, files handed to the user). Chomugiri gets the same behaviours in its own code and its own look.
- **Done means.** A reply survives the phone leaving the app, a file the assistant sends ends up on the phone, the model is told
  the truth about the terminal, and the transcript reads as an agent at work.

## Findings (each one observed, with where)
1. **No file could be saved inside the Android app.** `downloadBlob` clicks a `blob:` link, and the app's WebView had no download
   handling at all (`MainActivity.kt` had no listener, `ApiRouter.kt` no save route). Every "save" (a sent file, an APK, a zip)
   did nothing. Observed in the source; fixed with `/api/shell/save`, `FileSaver.kt` and a click hook in the bootstrap script.
2. **A sent file larger than 10 MB was refused** (`MAX_SEND_BYTES` in `runtime.ts`), so an APK could never be sent. Now 64 MB,
   and anything above 4 MB stays on the terminal and is fetched when saved (`bridgePath`).
3. **The whole app died when Android killed the page's renderer.** Observed on an emulator (Android 14, WebView 113): logcat
   `Render process crash wasn't handled by all associated webviews, triggering application crash`. That is the phone's
   "the app closed before this reply finished". `onRenderProcessGone` now rebuilds the screen; observed after the fix:
   `The page renderer is gone (crashed=true); rebuilding the screen.` with the app process still alive.
4. **Nothing kept the radio awake during a run.** `RunService` held a notification but no wake lock or Wi-Fi lock; a stream then
   ends with `Software caused connection abort` when the screen turns off. Both locks are now held for the run. Inferred cause,
   not yet confirmed on the user's vivo phone.
5. **A reply whose connection dropped before its first word ended the turn** (`Stream interrupted`). It is now asked for again,
   up to three times, waiting until the app is in front and online.
6. **Background mode told the model the terminal was offline** and builds were kept out of it; see the earlier commits. Builds
   go to the terminal again when Background is on; only a message that plainly needs a command now stays in the app.
7. **Tools did not scroll on a phone**: the list column had `shrink-0` in a column layout (`ToolsHub.tsx`).

8. **With Background on, commands in a reply stayed "waiting" and never ran.** Seen in a transcript from the phone: the first
   message ran its commands (it was routed to the app), the next three ("Scroll down…", "Continue", "Ok make a godot game") were
   background jobs, and a job was one model answer that cannot run anything. Fixed in bridge 5.2: an agent job runs the reply's
   commands on the terminal, hands the output back to the model and goes on until a reply runs nothing (`agent/jobs.mjs`,
   `scripts/test-agent-jobs.mjs`). On an older bridge a message is now sent the usual way instead of being left waiting.
9. **The model stopped to offer options ("months of work, which path?")** on a large request. The build prompt now says to build
   the smallest complete version that runs and to carry on past an obstacle. Wording only; not yet seen to change a real reply.

## Plan
| Step | State |
|---|---|
| Files reach the phone (save route, large files) | done, compiled; not yet exercised on a phone |
| Survive the background (renderer, locks, retry, battery screens) | done; renderer rebuild observed on the emulator |
| Tools scroll | done |
| Background runs the whole task on the terminal (bridge 5.2 agent jobs) | done and tested against a scripted model; needs the user's terminal updated to 5.2 |
| Approval card before a command or a file change in the chat (allow once / always / no) | todo |
| Task list in the transcript (what is done, what is next) | todo |
| CHoMU Engine (Godot 4.7.2 base) as the game target: project format, its addons in the prompt, open-on-phone export | todo |
| Trim the app to coding and game development | todo, needs the owner's list of what to remove |

## Unknowns
- Whether the wake lock and the vendor battery screen are enough on vivo (Funtouch/OriginOS); only the phone can tell.
- The emulator here has no hardware acceleration and its WebView (113) crashes on start, so no screen of the app was seen on it.
- CHoMU Engine's Linux build is ARM64 only; it cannot run on an x86 terminal, where stock Godot would have to stand in.

## Handoff
Next: the approval card and the task list, then the engine target. Traps: `npm run build` and the emulator do not fit in memory
together here; `scripts/export-static.mjs` does its own build; web assets in the APK live under `assets/web/next`, not `_next`.
