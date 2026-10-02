# Website videos — Google Flow prompts (mobile, 9:16)

Nine clips, **10 seconds each**, all **portrait 9:16** (the site is mobile-first; on a PC
they sit in a phone-shaped frame). Every clip starts from a real screenshot, so the video
begins from something true and then moves.

How to use in Flow: **Frames to Video** → upload the start frame → paste the prompt →
aspect **9:16** → generate 2–3 takes, keep the best.

## The AI-typing effect (in every clip)

Every clip has a line that **types itself letter by letter, as if an AI is writing it**:
a blinking orange cursor `▍`, a handwritten or monospace font, **short simple words only**
(video models mangle long text). The exact words to type are written in each prompt.
The site also types the same words in real HTML on top, so even if a take garbles a letter
the page stays correct.

## Look to keep consistent

- App clips: warm cream paper `#fff7ee`, ink brown `#2c2018`, orange `#ea580c` / `#fb923c` / `#c2410c`,
  hand-drawn wobbly outlines, soft paper grain.
- Game clips (5, 6, 7): cinematic, game-engine realism — not hand-drawn.

Add to the end of every prompt:
*Portrait 9:16. No subtitles, no watermark, no logos other than the orange ">_" mark. Only the typed words specified may appear as text.*

---

## 1 — Hero · `p01_home_light.png`

Portrait. The Chomugiri phone screen on warm cream paper. The glowing orange `>_` mark
sits in the center. Under it a line **types itself letter by letter with a blinking orange
cursor: "make me anything"**. As the last letter lands, hand-drawn orange ink lines burst
out of the mark and fold into small paper-cut drawings that float up and away one after
another: an Android phone, a game controller, a cube, a website window, a rocket. Camera
slowly pushes in. Soft golden light, floating paper dust, playful and warm.

## 2 — One sentence becomes a plan · `p05_prompt_typed.png`

Portrait screen-recording style, camera locked on the phone app. In the prompt box the
sentence **types itself letter by letter, as if an AI is typing: "build me a zombie game"**,
cursor blinking. A finger taps the orange run button. The screen switches to a checklist and
seven rows slide in one by one; each row's small circle fills orange and snaps to a check mark in
order, a thin orange light running down the edge. Smooth, confident UI motion, slight push-in.
Hand-drawn borders, cream background.

## 3 — It researches by itself · `p07_research_note.png`

Portrait. The chat screen, then the camera glides *into* the phone. In the chat a line
**types itself: "reading live pages..."** with a blinking cursor. Out of the screen, glowing
orange-ink threads fly to a ring of floating paper cards (a code repository, a docs page,
release notes, an encyclopedia page). Tiny glowing orange words lift off the cards and stream back
into the chat. One number on a release-notes card glows brighter, snaps into the chat, and the line
finishes typing **"found it"**. Warm cream and orange, fast and clever.

## 4 — Light and dark, one thumb · `p02_home_dark.png`

Portrait. A hand holds the phone showing the app in dark mode, orange mark glowing. A thumb
taps the sun icon: the whole screen swipes smoothly into cream light mode, then back. The
menu button is tapped and a hand-drawn sidebar slides in and out. A line **types itself:
"works on your phone"**. A tiny paper-craft APK hops out of the screen onto the hand. Soft window
light, shallow depth of field, cozy and tactile.

## 5 — Chomu Dead: the long night · `v5_street_horde.png` (or `v5_clinic.png`)

Portrait, cinematic third-person horror, night, heavy rain. A lone survivor in an olive jacket and
backpack stands in an abandoned street, flashlight cutting through fog. Pale grey ghouls shamble out of
the dark with arms out; one sprints. He fires a rifle: bright muzzle flash lights the rain, a ghoul
staggers back. Streetlamp flickers, lightning flashes behind a church. Handheld camera, low
saturation, film grain. At the bottom a terminal-style line **types itself: "02:14 AM. find a gun."**
with a blinking red cursor. Game-engine realism.

## 6 — Chomu Dead: the Warden · `v6_warden.png` then `v6_helicopter.png`

Portrait. A walled hospital yard at night, red emergency light on wet concrete. A towering muscular
ghoul in an orange prison jumpsuit with rusty chains on both arms stands in the middle, then charges the
camera at a run. The survivor dodges and fires, tracer rounds streak past. Cut to a rescue helicopter on
its pad, rotors spinning up, rain whipping sideways, the survivor sprinting toward it. Low dramatic angles,
dark teal and red lighting. A line **types itself in red: "run."** then **"get to the helicopter"**.

## 7 — Chomu Horizon: open-world racing · `h_drift.png` (or `h_low_cam.png`)

Portrait, bright, fast, joyful. A sports car races down a winding road through green hills at
golden hour, then the road flows into a glowing neon city and then a red desert canyon in one continuous
sweep with smooth transitions between the three worlds. The car drifts a corner kicking up smoke,
blue nitro flames burst, camera swoops from behind to the side to a low front shot. Warm sunset light,
lens flare, motion blur, high energy. A line **types itself along the bottom, speedometer-style: "3 worlds.
1 key."** with a blinking orange cursor. Clean, colorful game-engine look.

## 8 — A sentence becomes a 3D game character (TRELLIS + Godot) · `chars_portrait.png`

Portrait, dark studio with orange accents. A text prompt **types itself letter by letter, as an AI would:
"ghoul, grey skin, torn clothes"** in a glowing bubble. The bubble dissolves into a wireframe that sweeps over
itself and becomes a textured 3D character turning slowly on a turntable. A rig of glowing joints lights up inside
the body and it starts to walk. A car, a rifle and a house pop into the scene around it. Typed line at the bottom:
**"made with TRELLIS, built in Godot"**. Technical but friendly, smooth 3D motion.

## 9 — Download · `p03_menu_open.png`

Portrait. Three phones float in a column over warm cream — one showing a hand-drawn orange `>_` app, one a dark
horror street, one a sunset race car. Each phone gets a hand-drawn orange arrow that bounces onto a paper-craft
"install" button and an APK card pops into it with a satisfying snap. Confetti of orange paper bits.
A line **types itself: "download. install. play."** Camera slowly pulls back and ends on a calm still frame.

---

### Order on the site (top → bottom)

1 Hero → 2 Plan → 3 Research → 4 Phone → 5 + 6 Chomu Dead → 7 Chomu Horizon →
8 Godot / TRELLIS pipeline (with the three voices and their transcripts) → 9 Download.

### When the videos are ready

Send them and the site gets built: animated, scroll-driven, mobile-first, with real HTML typing on every
section, all three APK download links, a full description of every app, the voices in the Godot section with a
typed transcript under each, deployed to Vercel with your token.
