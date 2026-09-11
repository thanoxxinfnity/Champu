import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chomugiri — Autonomous Developer Workspace',
  description:
    'Autonomous developer workspace. NVIDIA NIM + Pollinations + universal OpenAI-compatible gateway, with a terminal tunnel bridge for real builds.',
  applicationName: 'Chomugiri',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }] },
};

export const viewport: Viewport = {
  // Matches the paper/desk backgrounds so the browser chrome does not flash a
  // colour the app never uses.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdf7ee' },
    { media: '(prefers-color-scheme: dark)', color: '#17120e' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

/**
 * Applies the saved theme before first paint.
 *
 * The real setting lives in IndexedDB with everything else, but that is async —
 * reading it in React would let one frame of the wrong theme through, which on a
 * dark-mode phone is a full-screen white flash. So the choice is mirrored into
 * localStorage purely as a synchronous boot hint, and a failure to read it just
 * falls through to the OS preference.
 */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('chomugiri:theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Self-hosted: the APK serves this from 127.0.0.1 with no network. */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
