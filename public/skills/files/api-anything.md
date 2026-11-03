# api-anything: websites as operations

api-anything (github.com/goodnight000/api-anything, MIT, Node 22.13+) learns a site's own request from a page URL and two example inputs, then replays it over plain HTTP. Calls run on the user's machine at human volume; specs never hold cookies.

## First: is it allowed, and is there already an API?
1. Look for an official API or OpenAPI/MCP: `npx -y api-anything search <site>` (the shared catalog), then the site's docs and `/robots.txt`.
2. Read the site's terms. If the page says automated access is not allowed (a 403 "Automated access is not allowed…"), or robots.txt disallows the path, stop: do not learn it, do not get around the block. Tell the user and use the official API if there is one (for notrack.ai that is api.notrack.ai: see the notrack-api skill).
3. Only reads of public pages, or of the user's own logged-in data on their own machine. Writes stay off unless the user asks (`--allow-writes`).

## Steps (run on the terminal / bridge machine, which needs a Chromium browser to learn)
1. Install and connect: `npx -y api-anything setup --yes` (or `--no-share` to keep everything private; it asks about sharing learned specs, default yes: ask the user). Check: `npx -y api-anything call hacker-news search query=sqlite` should give `"ok":true,"tier":1`.
2. Search first: `api-anything search <words or domain>` then `api-anything pull <site>` if someone already shared it.
3. Learn a new read: `api-anything capture "https://site.com/search?q=kittens" --example q=kittens --outline`, pick the candidate that carries the example, then `api-anything add <site> <op> --trigger "https://site.com/search?q={q}" --example q=kittens --example2 q=puppies --pick title,url`. Read the warnings; `unproven` means the server may ignore that parameter.
4. Call: `api-anything call <site> <op> q=piranesi` (JSON out). Check with a value you did not use as an example and compare with the page. `api-anything verify <site>`.
5. For agents: `api-anything mcp --print-config` prints the MCP entry for the client; `--sites a,b` serves each operation as its own tool.

## Limits to say out loud
- It learns pages that answer a URL with data. A live chat (a POST that streams a reply, needs a session or a challenge) is not what it learns; use the site's official API if it has one.
- Login-gated data needs the user's own session (`api-anything login <site>`), and they should know a spec learned signed in is not shared unless 3 networks learned the same thing.
- Nothing is checked on a real phone: this runs on the computer the terminal is on.