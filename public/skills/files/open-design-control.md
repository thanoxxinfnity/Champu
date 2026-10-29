# Controlling Open Design

Open Design (github.com/nexu-io/open-design, Apache-2.0) is already inside Chomugiri. It switches on by itself for design requests; you can also call each part:

| Need | Command |
|---|---|
| See everything | `/od` · `/od list skills` · `/od list styles` · `/od list templates` · `/od list prompts` · `/od list craft` |
| Use a design skill | `/od <skill> <task>` (for example a landing page, dashboard, deck, resume) |
| A brand's look | `/od style <brand> <task>`, or just say "Stripe jaisa" / "Apple style" |
| Start from a ready layout | `/od template <name> <task>` |
| A ready image or video prompt | `/od prompt <words>` |

## How to work with it
1. Decide the **kind** of deliverable first (screen, deck, document, poster, animation). Pick the Open Design skill for that kind rather than a generic approach.
2. Pick one **design system** that fits the user's brand or mood; if they named a brand, use it. State it in one line.
3. Start from a **template** when one is close (it saves the structure work); then change content and colours.
4. Apply the **craft rules** it adds (typography, colour, spacing, states, accessibility, anti-slop). Do not argue with them; check your result against them.
5. Build mobile-first: the output is usually opened on a phone. Check a 360 px width.
6. Finish with `design-review` or the review skill: list three weaknesses and fix them.

## Rules
- Use the pack's material as guidance, in your own words and code; do not copy a brand's logo or trademarked artwork into someone else's product.
- If the user did not say what they want, offer two directions (two design systems) in one line each, then build the one they pick.