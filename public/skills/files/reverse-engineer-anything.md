# REA — Reverse Engineer Anything (on the bridge)

REA (github.com/morluto/rea, MIT, npm `rea-agents`) is one CLI and MCP server for reverse engineering: Android APKs, JavaScript/Electron apps, website bundles and HAR captures, native ELF/PE/Mach-O binaries (with Ghidra, IDA, Hopper or Kuna), .NET, Flutter, Go, Rust, WASM, Godot PCK, Unity IL2CPP metadata, firmware, SQLite files and more. It answers with **Evidence** — what it observed, what it inferred, what stays unknown — never a guess dressed as a fact. This is Chomugiri's adaptation of REA's own `reverse-engineer-anything` skill for a phone app that drives a terminal bridge.

## 0. Is this allowed? Check first, every time
Use REA only on: software the user owns or built, or a target they have said **in this conversation** they are authorised to examine (a client engagement, a CTF, malware analysis, interoperability with a file format they own, preservation of something they legally have).
Never: bypass a licence check, DRM, anti-cheat, login or bot protection; tamper with an online service; build cheats; copy a company's proprietary code or assets into another product. A public website or app being downloadable is **not** permission. If the target is someone else's product and no authorisation was stated, say so in one or two lines, offer the lawful route (their public docs, API, or building the feature from scratch from its observable behaviour), and stop.

## 1. Setup (once per bridge)
- Needs Node.js 22.x ≥ 22.23.4, 24.x ≥ 24.22.1 or 26.12.1+. On older Node the first command fails: tell the user to update Node on the bridge machine; do not install it yourself.
- Run with `npx -y rea-agents@latest <command>` from a trusted directory **outside** the target, with **absolute** target paths. `rea doctor` once if something is missing; do not run it before every job.
- Engines are per target and are never installed by REA: Android needs JADX and a full JDK, native code needs Ghidra/IDA/Hopper/Kuna, packets need TShark. If one is missing, name it and what it is for; do not fake a result.
- Claude Code / Codex users on a desktop can register the MCP server with `npx rea-agents setup` (review the plan it shows before applying).

## 2. Route the target to the first command
| Target | First command |
|---|---|
| JS/Electron app folder or `.asar` | `analyze-javascript-application /abs/app --json > ev.json` |
| A website the user owns | `capture-browser-scenario` (declared actions) or `analyze-web-bundle`; `inspect-web-network-capture` for a saved HAR |
| Android APK | `inspect-android-package /abs/app.apk`, then `decode-android-resources`, `inspect-android-class`, `inspect-android-method`, `trace-android-references`; `inspect-apk-signature` for who signed it |
| Native binary | `analyze` / `inspect` with a provider, then `decompile`, `function`, `xrefs`, `search` |
| ZIP/IPA/PyInstaller/Bun exe, Godot PCK, Unity, Flutter | `inspect-artifact /abs/file`; `inspect-il2cpp-metadata`, `identify-flutter-build`, `inspect-dart-aot` |
| Firmware | `inspect-firmware-regions`; `extract-firmware` into a new absolute folder only when asked |
| Two versions | `compare-application-versions` / `compare-artifacts` |
| "How does feature X work?" | analyse first, then `trace-application-feature` from a known seed (a string, route or handler) |
Run `npx -y rea-agents@latest guided-workflows` or `<command> --help` for exact flags instead of guessing them.

## 3. Work summary-first
Big apps produce huge Evidence (hundreds of MB). Save it to a file and read a projection:
```bash
npx -y rea-agents@latest analyze-javascript-application /abs/app --json > ev.json
echo '{"source":{"kind":"evidence-file","path":"ev.json"},"view":{"kind":"summary"}}' | npx -y rea-agents@latest inspect-analysis-view -
```
Then page one collection (`{"kind":"page","collection":"modules","offset":0,"limit":32}`) or one module. Never paste a whole Evidence file into the chat; never repeat an identical analysis.

## 4. Report like an investigator
- Separate **observed**, **inferred** and **unknown**. Cite the Evidence ID, the function, string, route or file offset behind each claim, and keep REA's limitations (static analysis did not observe execution).
- Short and phone-readable: what the app is, how the asked-about feature works, where it lives, and what you could not see.
- If the user wants to build something similar: describe the behaviour and architecture in your own words and write **new** code; do not lift the target's code or assets.