# Agent Reach: one command per platform

Agent Reach (github.com/Panniantong/Agent-Reach, MIT) installs and tests the tools behind many platforms and exposes them as `agent-reach <channel> <action> [args]`.

**Install the right one.** The PyPI package named `agent-reach` is NOT this project: never `pip install agent-reach`. Follow the install guide in the repository (`docs/install.md` on GitHub, which uv-installs it into `~/.agent-reach/`), and ask the user before installing uv or anything else.

1. See what exists and works: `agent-reach channels` (and ask it for its doctor/status output if something fails).
2. Use a channel: `agent-reach bilibili search "keyword"`, and the same shape for the other channels it lists. Read the channel's own help (`agent-reach <channel> --help`) rather than guessing arguments.
3. Return the result as short lines (title, link, one-line summary), not a dump.

## Rules and safety
- Channels that need a login copy the session from the user's own browser. Use that only with the user's clear yes, preferably a secondary account, and never read, show or store passwords or cookies.
- Public content only for anything you quote; respect each platform's terms and rate limits; no mass collection and nothing about private individuals.
- If a channel is broken, say which one and use another route (search, crawl4ai-markdown, yt-dlp-media) instead of retrying in a loop.