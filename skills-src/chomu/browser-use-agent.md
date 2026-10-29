---
name: browser-use-agent
description: Let an AI drive a real headless browser to finish a web task (fill a form, click through pages, read live info) with the open-source browser-use library or plain Playwright. Use when the task needs several clicks or logged-in-free interaction that fetching a page cannot do.
category: automation
---
# browser-use: an AI that operates a browser

browser-use (github.com/browser-use/browser-use, MIT) gives a language model a browser: it reads the page, decides the next click or typing, and repeats until the task is done. It needs a model key from the environment the terminal already holds (OpenAI, Anthropic or Gemini style); never print it or write it into a file.

1. Install: `pip install browser-use && playwright install chromium`.
2. Minimal run:
```python
import asyncio
from browser_use import Agent
from langchain_openai import ChatOpenAI   # or the chat class of the provider the terminal has a key for
async def main():
    agent = Agent(task="Open example.com, find the pricing page and list the plans with prices", llm=ChatOpenAI(model="gpt-4o-mini"))
    result = await agent.run()
    print(result.final_result())
asyncio.run(main())
```
3. Give it one clear goal, a start URL and what the answer should look like; set a step limit (`max_steps=20`) so it cannot wander.
4. If the library or a key is missing, do the same with Playwright by hand: open, `page.get_by_role(...)`, `page.fill`, `page.click`, `page.screenshot`, and read `page.inner_text('body')`.
5. Report: the pages visited, what was read, a screenshot path. Say which steps really happened.

## Rules
- Public sites and the user's own accounts they have opened for you. Never enter passwords, card numbers or one-time codes; stop and ask the user to do that step.
- Never buy, post, send, delete or submit anything final without the user's explicit yes in this chat.
- Prefer the browse skill for simple reading; use this one only when interaction is the point.
