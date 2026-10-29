---
name: free-web-search
description: Search the web with no API key and no account: a private SearXNG metasearch instance or the duckduckgo_search library from the terminal. Use when you need live search results, links, news or image results and no paid search key is set up.
category: research
---
# Free web search (no key)

Two ways, both run on the terminal (the bridge), both free. Pick the lighter one first.

## A. duckduckgo_search (Python, one command, no setup)
1. `pip install -U duckduckgo_search` (the package may also be published as `ddgs`; if the import fails try that name).
2. Text results: `python3 -c "from duckduckgo_search import DDGS; import json; print(json.dumps(DDGS().text('your query', max_results=8), indent=1))"`
3. News: `DDGS().news('query', max_results=8)` · images: `DDGS().images('query', max_results=8)`.
4. Each result has `title`, `href`, `body`. Quote the title and URL; open the best two with `curl -sL <url> | head -c 6000` or the browser skill before you rely on a claim.

If a search returns nothing or a rate-limit error, wait 20 seconds, shorten the query, and try once more; do not loop.

## B. SearXNG (a private search engine on the terminal machine)
Use when many searches are needed or DuckDuckGo throttles.
1. `docker run -d --name searxng -p 8888:8080 searxng/searxng` (needs Docker). In `/etc/searxng/settings.yml` inside the container add `json` under `search.formats` so the API answers JSON, then restart the container.
2. Query: `curl -s "http://localhost:8888/search?q=your+query&format=json" | python3 -c "import sys,json; [print(r['title'], r['url']) for r in json.load(sys.stdin)['results'][:8]]"`.
3. It merges Google, Bing, DuckDuckGo and more. Never expose port 8888 to the internet.

## Rules
- Results are leads, not facts: read the page before you state something from it, and say which sites you used.
- Phone-friendly output: at most 8 results, one line each (title — URL), then your answer.
- No key is needed, so never ask the user for one for this.
