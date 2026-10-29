# Scrapling: robust scraping of public pages

Scrapling (github.com/D4Vinci/Scrapling, BSD-3) is a Python scraping framework: a fast HTTP fetcher, a browser-based fetcher for pages that need JavaScript, and selectors that find an element again after the site's markup changes.

1. Install on the terminal: `pip install "scrapling[all]" && scrapling install` (installs the browsers).
2. Fast path (static pages):
```python
from scrapling.fetchers import Fetcher
page = Fetcher.get("https://example.com/list")
for item in page.css(".item"):
    print(item.css("a::text").get(), item.css("a::attr(href)").get())
```
3. When the HTML is an empty shell, use the browser fetcher: `from scrapling.fetchers import DynamicFetcher` and `DynamicFetcher.fetch(url)`; same `.css()` calls.
4. Save as you go (`items.json` / `.csv`) and show the user the first 5 rows, not the whole table.
5. Selectors: prefer a stable attribute (`data-*`, `itemprop`, role) over a long class chain; Scrapling can re-locate an element with `auto_save=True` then `adaptive=True` when the page changes later.

## Rules
- Only pages the user may read, at a human pace (one request every second or two, a short list, not a mass download). Respect `robots.txt` and the site's terms.
- Do not use it to get around a login, a paywall, rate limits or a block: if the site refuses, stop and say so.
- Never collect personal data about private people.