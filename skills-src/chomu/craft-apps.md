---
name: craft-apps
description: Install and drive the open-source Craft apps (PhotoCraft instead of Photoshop, VectorCraft, FilmCraft, LightCraft, EffectCraft, DesignCraft, PdfCraft, WordCraft, DeckCraft, GridCraft, CADCraft, FigCraft, SoundCraft, TextureCraft, MaterialCraft, AniCraft, ArtCraft) on the terminal bridge computer. Use when the user wants to edit a photo or PSD, make vector art, cut video, lay out a page, edit a PDF or an Office-style file with free open-source tools, or types /craft.
category: automation
---
# Craft apps (on the bridge)

The Craft apps are open-source desktop programs from github.com/storytold (MIT or Apache-2.0, alpha quality). They are source code, not model weights. They run on the computer the Terminal Bridge runs on, never inside the phone. Bridge 5.1 or newer is needed.

## Commands (one per terminal block)
- `node "$CHOMUGIRI_AGENT" craft list` shows every app and whether it is installed.
- `node "$CHOMUGIRI_AGENT" craft install photocraft` downloads the release for this computer from github.com. The SHA-256 is checked when the release publishes one; say so honestly when it does not.
- `node "$CHOMUGIRI_AGENT" craft run photocraft run in.psd --cmd filter.sharpen.smartSharpen --params '{"amount":80}' --out out.png` runs PhotoCraft without a window. `craft run photocraft batch --actions a.json --in dir --out dir` does many files. `craft run photocraft --help` lists the rest.
- `node "$CHOMUGIRI_AGENT" craft where <app>` prints the installed file.
- To see an app's window: start the private screen (`node "$CHOMUGIRI_AGENT" desktop start`), open it with the Craft apps page (sidebar, Craft apps, Open on screen), then use `desktop shot`, `desktop click x y`, `desktop type …`.

## Rules
1. Run `craft list` first. If the app is not installed, ask before installing it (it is a large download), then install.
2. If an install says the release has no file for this computer, report that message as it is. Do not try another source and do not run a file that was not downloaded by `craft install`.
3. Work on copies in the workspace. Write results next to the input with a new name and show the user the output (send the image).
4. Say plainly that these are alpha programs. If a command fails, show the error and try the smaller step (one `--cmd`) before giving up.
5. ArtCraft's AI features call hosted models with their own terms and keys. Do not claim they run offline.
6. Never pretend a Craft app did something. Report only what the command printed.
