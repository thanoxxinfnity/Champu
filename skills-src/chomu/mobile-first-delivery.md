---
name: mobile-first-delivery
description: Make everything you build and every answer you write work on a phone first: small screens, touch targets, short answers, links and files that open on a phone. Use for every UI, website, app, document or report, and whenever the user works from a phone (Chomugiri's own users mostly do).
category: design
process: true
---
# Mobile first, always

Assume the reader holds a phone in one hand, on a weak connection.

## When you build
- 360 px width is the first layout: single column, `meta viewport`, `min-height: 44px` for anything tappable, 16 px minimum body text, no hover-only actions, no horizontal scroll.
- Keep a page under about 1 MB for the first load; compress images, lazy-load the rest.
- Test it at 360 × 740 with a real screenshot before saying it works; look at the picture.
- Games and apps: on-screen controls placed for thumbs, nothing important under the notch or gesture bar, a pause that always works.

## When you answer
- Short paragraphs, the result first, then the one next step. Tables become lists when they have more than two columns.
- Code in files or blocks the user can copy with one tap; long output goes to a file and you give the path/link.
- Never ask the user to type a long command: put it behind a button, a skill or one line.

## When you deliver
- A link that opens on the phone beats an attachment. State the file size for downloads (APK, zip).
- Say what you verified and what you could not check on a real phone.
