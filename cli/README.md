# chomugiri — a coding agent for the terminal

One command that reads, searches, edits and runs things in the folder you start it in, and asks before every change. It is two plain
`.mjs` files with no dependencies, so it runs wherever Node 18+ runs: a laptop, a server, Termux on a phone.

```bash
node cli/chomugiri.mjs                       # talk in this folder
node cli/chomugiri.mjs "fix the failing test"
node cli/chomugiri.mjs -p "what does src/app.js do?"     # answer once and exit
cat build.log | node cli/chomugiri.mjs -p "what failed?"
node cli/chomugiri.mjs -c                    # continue the last conversation of this folder
npm link && chomugiri                        # optional: install the `chomugiri` command
```

## Models
With no setup it uses Pollinations (free, no key, about one reply every 45 seconds). Any OpenAI-compatible endpoint works:

```bash
chomugiri providers                          # pollinations, openrouter, groq, gemini, nvidia, cerebras, mistral, openai, ollama
chomugiri config provider groq               # then: export GROQ_API_KEY=...   (or: chomugiri config key <value>)
chomugiri config model llama-3.3-70b-versatile
chomugiri --base-url https://host/v1 --model my-model     # anything else (key: CHOMUGIRI_API_KEY)
```
Keys saved with `config key` live in `~/.chomugiri/config.json`, readable only by you.

## While talking
`/help /model /provider /key /status /clear /compact /yes /init /sessions /resume /exit` · `!command` runs a command yourself ·
`@path` puts a file into your message · end a line with `\` to continue it · Ctrl+C stops the current work, twice quits.
`/init` writes `CHOMUGIRI.md` (how to build, run and test the project); it is read at the start of every conversation, as are
`AGENTS.md` and `CLAUDE.md`.

## How it works
The model gets six tools: `run`, `read`, `search`, `list`, `write`, `edit`. Endpoints with tool calling use it; for the others the model
writes the same actions as fenced blocks. Results go back to the model until it answers without an action (25 rounds at most per message).

## Safety
- Reading and searching are free. Every file change shows a diff and every command is shown, and each waits for `y`; `a` allows that
  kind for the rest of the conversation, `--yes` allows all of them from the start.
- Files outside the start folder cannot be read or written.
- Commands that wipe the disk or the home folder are never run. `sudo`, `curl | sh`, `rm -r`, `git push --force`, `git reset --hard`
  always ask, even with `--yes`.
- In `-p` mode nobody can be asked, so without `--yes` nothing is changed and the model is told so.

Tests: `node scripts/test-cli.mjs` (a fake model server drives the whole loop).
