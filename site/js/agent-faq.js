/**
 * Answers the helper can give with no network at all: the questions people actually ask about Chomugiri
 * and Chomu Horizon. Instant, always available, and written from the same facts the AI is given.
 *
 * It exists because the free text service behind the panel is often down or rate-limited, and "the agent is
 * busy" is a poor answer to "how do I install it?". When a question matches, this answers straight away —
 * no waiting, nothing sent anywhere. Anything else goes on to the AI.
 *
 * Matching is deliberately cautious: a question only counts as being about us if it says so (Chomugiri,
 * Chomu, Horizon, the app, the site, the APK) or follows one that did, so "how do I install Python?" is
 * never answered with our install steps.
 */
import { DOWNLOADS } from './agent-core.js';

const US = /chomu|horizon|\bapk\b|\b(this|the|your|ur) (app|site|website|game|agent)\b|\bthe app\b/i;
const HINGLISH = /\b(kya|kaise|kese|hai|hain|karu|karun|kare|karo|batao|bata|ka|ke|ki|me|mein|nahi|nhi|bhai|bro|kaun|konsi|kaunsi|mujhe|mera|meri|aap|tum|kitna|kab|kyun|kyu|wala|wali)\b/i;
export const looksHinglish = (text) => (text.match(new RegExp(HINGLISH.source, 'gi')) ?? []).length >= 1;

const A = DOWNLOADS.chomugiri;
const H = DOWNLOADS.horizon;

const ENTRIES = [
  {
    id: 'hello',
    any: [/^\s*(hi+|hello+|hey+|yo|namaste|hola|sup|good (morning|evening|afternoon))\b[\s!.,]*(there|bro|bhai|chomu|agent|buddy)?[\s!.?]*$/i],
    en: "Hey! I'm Chomu agent. Ask me about Chomugiri or Chomu Horizon — how to install, what they can do — or anything else you're curious about.",
    hi: 'Hey! Main Chomu agent hoon. Chomugiri ya Chomu Horizon ke baare me poochho — install kaise karein, kya kar sakte hain — ya koi aur sawal bhi.',
  },
  {
    id: 'horizon-install',
    any: [/\b(install|download|apk|setup|get)\b/i],
    ctx: 'horizon',
    en: `To get Chomu Horizon:\n1. On your Android phone, open this link:\n${H}\n2. When it has downloaded (it is big, about 110 MB — use Wi-Fi), open the file.\n3. If Android warns about "unknown sources", allow installs from your browser.\n4. Turn the phone sideways and pick a car. The Kaze R-Spec is free.`,
    hi: `Chomu Horizon lene ke liye:\n1. Android phone par ye link kholo:\n${H}\n2. Download hone ke baad (file badi hai, lagbhag 110 MB — Wi-Fi use karo) file kholo.\n3. Android "unknown sources" ka warning de to apne browser se install ki ijazat de do.\n4. Phone ko aadha ghumao aur car chuno. Kaze R-Spec free hai.`,
  },
  {
    id: 'install',
    any: [/\b(install|download|apk|setup|get)\b/i, /kaise (le|lu|laun|chalau)/i],
    ctx: 'us',
    not: /\b(python|node|java|windows|linux|mac|macos|ios|iphone|pip|npm|android studio|chrome|whatsapp)\b/i,
    en: `To get Chomugiri (Android only, about 17 MB):\n1. On your phone, open this link:\n${A}\n2. Open the downloaded Chomugiri.apk.\n3. If Android warns about "unknown sources", allow installs from your browser — the app is not on the Play Store.\n4. Open it and start typing. No sign-up.`,
    hi: `Chomugiri (sirf Android, lagbhag 17 MB) lene ke liye:\n1. Phone par ye link kholo:\n${A}\n2. Download hui Chomugiri.apk kholo.\n3. Android "unknown sources" ka warning de to apne browser se install ki ijazat de do — app Play Store par nahi hai.\n4. App kholo aur type karna shuru karo. Sign-up nahi chahiye.`,
  },
  {
    id: 'horizon-maps',
    any: [/\bmaps?\b|\bworlds?\b|\blevels?\b|\bwhere (can|do) (i|you) (drive|race)\b|kahan (chala|drive)/i],
    ctx: 'horizon',
    en: 'Chomu Horizon has five big open-world maps, linked by portals:\n- Horizon Hills — green countryside with a lake\n- Neo Metro — a dense Mumbai-styled city, lit up at night\n- Red Canyon — a desert mesa\n- Frost Peak — a snowy pass with a frozen lake\n- Wild Trail — an off-road map\nDrive through a portal ring and you arrive on another map with the same car and save.',
    hi: 'Chomu Horizon me paanch bade open-world maps hain, portals se jude hue:\n- Horizon Hills — hari-bhari pahadiyan aur jheel\n- Neo Metro — ghana Mumbai-style shehar, raat me roshan\n- Red Canyon — registani mesa\n- Frost Peak — barfeela pass, jami hui jheel ke saath\n- Wild Trail — off-road map\nPortal ring se guzro to dusre map par wahi car aur save ke saath pahunch jaoge.',
  },
  {
    id: 'horizon-cars',
    any: [/\bcars?\b|\brides?\b|\bvehicles?\b|\bbikes?\b|\bhorse\b|\bgarage\b|\btrucks?\b|gaadi|gaadiyan/i],
    ctx: 'horizon',
    en: 'Chomu Horizon has nine rides:\n- Vortex GT-R (supercar), Brute 69 SS (muscle), Relic Custom (classic)\n- Kaze R-Spec (JDM) — free\n- Ranger Overland (off-road), Titan Crusher (monster truck)\n- Raptor RR (motorbike), Pedal One (bicycle) — free, Wild Steed (a horse)\nCoins you pick up buy the pricier ones. In the garage you change paint (metallic, matte, pearl, chameleon), rims and underglow.',
    hi: 'Chomu Horizon me nau rides hain:\n- Vortex GT-R (supercar), Brute 69 SS (muscle), Relic Custom (classic)\n- Kaze R-Spec (JDM) — free\n- Ranger Overland (off-road), Titan Crusher (monster truck)\n- Raptor RR (motorbike), Pedal One (cycle) — free, Wild Steed (ghoda)\nJo coins uthate ho unse mehngi rides milti hain. Garage me paint (metallic, matte, pearl, chameleon), rims aur underglow badal sakte ho.',
  },
  {
    id: 'horizon-controls',
    any: [/\bcontrols?\b|\bdrift\b|\bnitro\b|\bsteer\b|\btouch\b|\brewind\b|\bhow (do|to) (i )?(play|drive)\b|kaise (chala|khel)/i],
    ctx: 'horizon',
    en: 'Chomu Horizon controls (landscape): left thumb steers (arrow buttons or a stick — you choose in the garage). Right thumb: GAS and BRAKE, DRIFT (handbrake) and the nitro ring — drifting refills nitro. Every finger is tracked separately, so you can steer, accelerate and use nitro together. There is a 3-second rewind, and four camera views plus free look.',
    hi: 'Chomu Horizon ke controls (landscape): baayen angoothe se steer (arrow buttons ya stick — garage me chun sakte ho). Daayen angoothe se GAS aur BRAKE, DRIFT (handbrake) aur nitro ring — drift se nitro wapas bharta hai. Har ungli alag track hoti hai, to steer, gas aur nitro ek saath chal sakte hain. 3 second ka rewind hai, aur chaar camera views plus free look.',
  },
  {
    id: 'horizon',
    any: [/\bhorizon\b/i],
    en: `Chomu Horizon is an open-world racing game for Android phones, in the spirit of Forza Horizon, made with the Godot Engine through Chomugiri's own pipeline. Five maps, nine rides (a supercar to a bicycle and a horse), real suspension, drifting, nitro, a 3-second rewind, and a garage for paint, rims and underglow. Landscape, about 110 MB. Download: ${H}`,
    hi: `Chomu Horizon Android phones ke liye open-world racing game hai, Forza Horizon jaisa, Godot Engine se Chomugiri ki apni pipeline se bana. Paanch maps, nau rides (supercar se cycle aur ghode tak), real suspension, drift, nitro, 3 second rewind, aur paint/rims/underglow ke liye garage. Landscape, lagbhag 110 MB. Download: ${H}`,
  },
  {
    id: 'research',
    any: [/\bresearch\b|live web|search the web|\bsources?\b|logo pills?|\bpills?\b|web (search|par|pe) (karta|dekhta)/i],
    ctx: 'us',
    en: 'Before a build, Chomugiri researches the live web by itself: it works out what it might be wrong about (current versions, what changed recently), searches, reads the pages, keeps only the facts that matter and builds with them. Then it tells you what it did and lists the pages it read as pills, each with that site\'s own logo. Example: it found the current Godot is 4.7.2, which its own memory did not know.',
    hi: 'Build se pehle Chomugiri khud live web par research karta hai: pehle sochta hai ki wo kis cheez me galat ho sakta hai (abhi ke versions, haal me kya badla), phir search karke pages padhta hai, kaam ke facts rakhta hai aur unhi se build karta hai. Phir bata deta hai ki kya kiya, aur jo pages padhe unhe pills me dikhata hai, har ek par us site ka apna logo. Example: usne pata lagaya ki abhi Godot 4.7.2 hai, jo uski apni memory me nahi tha.',
  },
  {
    id: 'bridge',
    any: [/\bbridge\b|\bcompil|build (an? )?apk|\bterminal\b|\bgradle\b|run (commands|builds?)/i],
    ctx: 'us',
    en: 'Real builds (compiling an APK, exporting a Godot game) run on a small helper on your own computer, called the terminal bridge. It works only inside one folder you pick, refuses paths that try to escape it, and you can stop it any time. If it is not connected, steps that need it are marked "blocked" — never faked. A guard also stops a command that fails the same way twice and changes approach.',
    hi: 'Asli builds (APK compile karna, Godot game export karna) tumhare apne computer par ek chhote helper par chalte hain, jise terminal bridge kehte hain. Wo sirf tumhare chune hue ek folder ke andar kaam karta hai, bahar nikalne wale paths mana karta hai, aur tum use kabhi bhi rok sakte ho. Connected na ho to jin steps ko iski zarurat hai wo "blocked" dikhte hain — nakli nahi kiye jaate. Ek guard ek hi tarah fail hone wale command ko do baar ke baad rok deta hai aur tareeka badalta hai.',
  },
  {
    id: 'models',
    any: [/\bmodels?\b|\bnvidia\b|\bnim\b|\bkimi\b|\bdeepseek\b|api keys?|\bkeys?\b/i],
    ctx: 'us',
    en: 'Chomugiri is not tied to one AI. It uses the NVIDIA NIM catalogue (dozens of models; needs your own key), a free option with no key that works right after install, and any custom endpoint you add that speaks the common chat API (Anthropic- and Gemini-style too). You paste keys in Settings → API Keys; they stay in the phone\'s private storage and go only to the provider they belong to. A model\'s reasoning sits in a drawer you can open.',
    hi: 'Chomugiri kisi ek AI se bandha nahi hai. Wo NVIDIA NIM catalogue (kai models; apni key chahiye), ek free option jo install ke turant baad bina key ke chalta hai, aur tumhara joda hua koi bhi custom endpoint (Anthropic aur Gemini style bhi) use karta hai. Keys Settings → API Keys me paste karte ho; wo phone ki private storage me rehti hain aur sirf usi provider ko jaati hain jiski hain. Model ki reasoning ek drawer me rehti hai jo khol sakte ho.',
  },
  {
    id: 'safe',
    any: [/\bdata\b.*\bsafe\b|\bsafe\b.*\bdata\b|\bprivacy\b|\bprivate\b|\btracking\b|\banalytics\b|\bsecure\b|\bsafe\b|surakshit/i],
    ctx: 'us',
    en: 'Chomugiri has no accounts and no analytics. On Android the app\'s backend runs on the phone itself, so your messages go from your phone straight to the model provider you chose — no server of ours in between. Your keys stay in the app\'s private storage. This website stores nothing about you except whether you picked light or dark. Full details are on the privacy page: /privacy',
    hi: 'Chomugiri me koi account nahi aur koi analytics nahi. Android par app ka backend phone par hi chalta hai, to tumhare messages phone se seedhe tumhare chune hue model provider ko jaate hain — beech me hamara koi server nahi. Tumhari keys app ki private storage me rehti hain. Ye website tumhare baare me sirf itna yaad rakhti hai ki light chuna ya dark. Poori details privacy page par hain: /privacy',
  },
  {
    id: 'sessions',
    any: [/\bsessions?\b|\bqueue\b|\bqueued\b|\brunning\b|multiple chats?|two chats?|ek saath/i],
    ctx: 'us',
    en: 'Each chat is its own session. "Running" shows only in the session that is actually running; your other sessions stay idle. If you send a message while something is running, it waits in a queue ("queued 1, 2…" — you can remove any) and starts one after another. Only one run goes at a time.',
    hi: 'Har chat apna alag session hai. "Running" sirf usi session me dikhta hai jo sach me chal raha hai; baaki sessions idle rehte hain. Kuch chal raha ho aur tum message bhejo to wo queue me wait karta hai ("queued 1, 2…" — koi bhi hata sakte ho) aur ek ke baad ek chalta hai. Ek waqt me ek hi run chalta hai.',
  },
  {
    id: 'build',
    any: [/what (can|does) (it|chomugiri|the app) (build|make|do)|what (all )?can (it|chomugiri) (build|make|do)|kya (kya )?(bana|build|kar) (sakta|sakte|leta|deta)|can (it|chomugiri) (build|make)/i],
    en: 'Chomugiri builds real things from a sentence:\n- Android apps (a real compiled APK)\n- Games (Godot projects with levels, sound, rigged 3D models)\n- Minecraft add-ons (.mcaddon)\n- Studio files: slide decks, documents, spreadsheets, pictures\n- 3D models and websites (deployed to Vercel)\nIt plans first with a checklist, researches the live web, and builds for real.',
    hi: 'Chomugiri ek line se asli cheezein banata hai:\n- Android apps (asli compile hua APK)\n- Games (Godot projects — levels, sound, rigged 3D models)\n- Minecraft add-ons (.mcaddon)\n- Studio files: slide decks, documents, spreadsheets, pictures\n- 3D models aur websites (Vercel par deploy)\nPehle checklist se plan karta hai, live web par research karta hai, aur asli build karta hai.',
  },
  {
    id: 'what',
    any: [/what is chomugiri|what'?s chomugiri|chomugiri (kya|what|is)|tell me about chomugiri|about (the )?(app|chomugiri)|chomugiri ke baare|ye (app )?kya hai|what is this (app|site)/i],
    en: `Chomugiri is an AI developer workspace for Android. You describe something — an app, a game, a Minecraft add-on, a deck, a website — and it plans it, researches the live web first, builds the files and gives you the finished thing. Questions get direct answers (Lane A); build requests get a checklist and real builds (Lane B). No accounts, no analytics. Download: ${A}`,
    hi: `Chomugiri Android ke liye ek AI developer workspace hai. Tum bas bolte ho — app, game, Minecraft add-on, deck, website — aur wo plan banata hai, pehle live web par research karta hai, files banata hai aur taiyaar cheez deta hai. Sawalon ke seedhe jawab (Lane A); build requests par checklist aur asli build (Lane B). Na account, na analytics. Download: ${A}`,
  },
  {
    id: 'voices',
    any: [/\bvoices?\b|godot (licen[cs]e|notice)|transcripts?|recordings?/i],
    ctx: 'us',
    en: 'The Voices section (in "Made with Godot Engine") has three recordings — narration, voice A and voice B — reading the Godot Engine licence notice, with a transcript that types itself in time with the voice. You can also download each .wav.',
    hi: 'Voices section ("Made with Godot Engine" me) me teen recordings hain — narration, voice A aur voice B — jo Godot Engine ka licence notice padhti hain, aur transcript voice ke saath khud type hota hai. Har .wav download bhi kar sakte ho.',
  },
];

/**
 * `text` is what the visitor just wrote; `before` are their earlier messages (for "and the cars?" after a Horizon question).
 * Returns the answer, or null if this is not something we can answer without the AI.
 */
export function faqAnswer(text, before = []) {
  const t = text.trim();
  if (!t || t.length > 200) return null;
  const chip = CHIP_ANSWERS[t];
  const recent = before.slice(-3);
  const hinglish = looksHinglish(t);
  const hz = /horizon|racing game/i;
  for (const e of ENTRIES) {
    if (chip) { if (e.id !== chip) continue; return hinglish ? e.hi : e.en; }
    if (!e.any.some((re) => re.test(t))) continue;
    if (e.not?.test(t)) continue;
    // Is the visitor talking about us? Either they say so, or an earlier message of theirs did.
    if (e.ctx === 'us' && !(US.test(t) || recent.some((m) => US.test(m)))) continue;
    if (e.ctx === 'horizon' && !(hz.test(t) || /chomu/i.test(t) && /\b(game|race|racing|drive)\b/i.test(t) || recent.some((m) => hz.test(m)))) continue;
    return hinglish ? e.hi : e.en;
  }
  return null;
}

/** Chip text → answer, for the suggestion chips the panel shows. */
export const CHIP_ANSWERS = {
  'How do I install Chomugiri?': 'install',
  'What can it build?': 'build',
  'Chomu Horizon kya hai?': 'horizon',
  'Is my data safe?': 'safe',
};
