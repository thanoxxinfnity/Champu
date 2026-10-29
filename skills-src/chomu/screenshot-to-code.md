---
name: screenshot-to-code
description: Turn a screenshot, mock-up or hand sketch of a screen into working HTML, Tailwind, React or Vue code, the way abi/screenshot-to-code does, and check the result against the picture. Use when the user shares an image of a UI and wants it built, copied closely or made responsive for a phone.
category: design
---
# Screenshot to code

Chomugiri has this built in (Screenshot → Code in the sidebar, after github.com/abi/screenshot-to-code, MIT); this is the method it follows, so chat requests get the same result.

1. Look at the image first. Write down, in one short list: layout regions top to bottom, colours (hex), fonts and sizes, spacing rhythm, every icon and image, every state visible (hover, selected, error). Do not start coding until that list exists.
2. Pick the stack the user named; default to one self-contained `index.html` with Tailwind via CDN so it runs everywhere, including on a phone.
3. Build mobile-first: single column at 360 px, touch targets at least 44 px, no fixed pixel widths, `meta viewport`, images with `max-width:100%`. Only add wider layouts with breakpoints.
4. Use real placeholders: `https://placehold.co/WxH` for images, inline SVG for icons, real-looking text taken from the screenshot (do not write lorem ipsum when the picture has words).
5. Compare with the screenshot: render it (screenshot with the browser skill), place both side by side, and fix the three biggest differences (usually spacing, font weight, colour). Say what still differs.
6. Deliver: the code in one block or file, how to open it, and a list of what was copied exactly and what was approximated.

## Rules
- Reproduce the layout and look the user shows; do not copy a brand's logo, trademarked artwork or private data into a product that is not theirs. Replace those with neutral placeholders and say so.
- Keep it accessible: real `button`/`a`/`label` elements, alt text, contrast you checked.
