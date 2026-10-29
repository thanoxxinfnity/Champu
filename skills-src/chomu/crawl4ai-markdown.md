---
name: crawl4ai-markdown
description: Turn any web page, including JavaScript-heavy ones, into clean markdown or structured data with Crawl4AI, free and without an API key. Use to read docs, articles, product pages or to crawl several pages of one site for an answer.
category: research
---
# Crawl4AI: pages to clean markdown

Crawl4AI (github.com/unclecode/crawl4ai, Apache-2.0) drives a headless browser and returns LLM-ready markdown.

1. Install once on the terminal: `pip install -U crawl4ai && crawl4ai-setup` (it downloads a browser; check with `crawl4ai-doctor`).
2. One page from the shell: `crwl https://example.com -o markdown` (use `-o json` for structured output).
3. In Python, for control and several pages:
```python
import asyncio
from crawl4ai import AsyncWebCrawler
async def main():
    async with AsyncWebCrawler() as c:
        r = await c.arun(url="https://example.com")
        print(r.markdown[:6000])
asyncio.run(main())
```
4. For a whole docs site: read the first page, collect the links that stay on the same host, and crawl only those that match what the user needs (at most 10 pages; say so).
5. Keep what you show short: the part of the markdown that answers the question, with the URL it came from.

## Rules
- Respect `robots.txt`, rate limits and the site's terms; read public pages only. No logins, no paywalls.
- If the page needs scrolling or a click to show content, pass JavaScript through the run config instead of guessing from the empty HTML.
- If the install fails (no browser, low disk), fall back to `curl -sL <url>` and strip tags; tell the user you did.
