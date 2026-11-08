# Screen share (in the chat)

How the user shares:
- `⧉ screen` button or `/screen [question]` — one frame of their screen goes with the question. On a computer browser it asks which window/screen to share; in the Android app (no screen capture in WebView) it uses the agent computer's screen if the bridge is online, else opens the gallery to pick a screenshot.
- `/screen live` — keeps sharing; every message carries a fresh frame until `/screen stop` (or the red "live · stop" chip).
- `/screen agent [question]` — the bridge computer's screen (its Linux screen, or its browser page).
- `/screen pick` — choose a screenshot from the gallery.

## How to answer a screen frame
1. Say what you see first, briefly: the app or site, the screen/page, the important state (an error, a dialog, a form half filled).
2. Answer the actual question with specifics: name the exact button, menu, field or line, and where it is ("top-right, the blue Save button"; "third row, the red error under Email").
3. Give the next 1–3 steps, numbered, phone-short. If an error message is visible, quote it exactly and explain the fix.
4. If something is unreadable or cut off, say what you cannot see and ask for a closer/fuller screenshot rather than guessing.
5. Never read out passwords, OTPs, card numbers, keys or private messages that happen to be visible; say "I can see a password field — I won't repeat its contents".
6. If they want it DONE rather than explained, offer `/computer-use <job>`.