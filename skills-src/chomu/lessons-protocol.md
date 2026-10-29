---
name: lessons-protocol
description: The habit that stops the same mistake from happening twice: how to read the LESSONS block, write a good lesson after a correction, and check your plan against the lessons before acting. Use at the start of any task when lessons exist, and right after the user says something was wrong.
category: meta
process: true
---
# Never make the same mistake twice

Chomugiri keeps a list of **lessons** (kind `lesson` in memory). Every session starts with all of them in front of you, under "LESSONS".

## Before you act
1. Read the lessons. For each one ask: does my plan touch this? If yes, follow the rule; do not "check later".
2. If a lesson conflicts with the user's new instruction, the user wins, and you say so in one line.

## When the user says it was wrong
1. Do not defend or apologise at length. Say in one sentence what went wrong (the real cause, not the symptom).
2. Fix it, then **verify the fix yourself** (run it, render it, open it) before saying it is done.
3. Write the lesson: `/lesson <rule>`. A good lesson is one imperative sentence that would have prevented it in any later session: "Never publish a 3D model without rendering front, side and back first." Not "I made a mistake with the model."
4. If it was a tool or API surprise (wrong package, a flag that does not exist), the lesson names the right way: "The PyPI package agent-reach is not Agent Reach; install from the GitHub guide."

## What makes a lesson good
- Specific (names the tool, file type or setting), general (applies again), short, actionable, no secrets.
- One per mistake. Merge duplicates (`/memory forget <words>` removes an outdated one).

## Mobile
Lessons live on the device. After you save one, the chat shows "Lesson kept". The user can see and delete all of them with `/lessons`.
