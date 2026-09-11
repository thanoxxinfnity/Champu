# Chomugiri for Android

The full Chomugiri workspace as a standalone APK. No server to deploy, no
account, no proxy — model calls go straight from the device to NVIDIA NIM,
Pollinations, or your own endpoint.

## How it works

The web build needs its `/api/*` routes because a browser cannot call NVIDIA NIM
directly (no CORS headers) and the key must stay off the client. **Neither
constraint exists inside an Android app**: a native HTTP client ignores CORS, and
the key lives in the user's own device storage.

So the APK inverts the architecture:

```
WebView ──http://127.0.0.1:<random port>──► HttpServer.kt  (this process)
   │                                            │
   │  the Next.js bundle, byte-for-byte          ├── serves assets/web/
   │  unchanged from the web build               └── ApiRouter.kt
   │                                                  ├── /api/models
   └── fetch('/api/chat') … same code                 ├── /api/chat      (SSE)
                                                      ├── /api/image
                                                      ├── /api/research
                                                      ├── /api/endpoints/probe
                                                      ├── /api/bridge/proxy
                                                      └── /api/vercel/deploy
```

A real socket rather than `shouldInterceptRequest`, because that callback never
exposes a POST body on Android — and Chomugiri POSTs JSON and reads SSE back.
Binding loopback means the web client runs with **zero Android-specific branches**.

### Security

- The server binds `127.0.0.1` only; nothing off-device can reach it.
- Other apps share the loopback interface, so `/api/*` additionally requires a
  32-char token generated per launch and injected into the WebView. Without it
  every API call returns `403 bad_session`.
- Cleartext is permitted for loopback only. All outbound traffic stays HTTPS.
- The NIM key is stored in the app's private `SharedPreferences`.

## Build

```bash
# from the repo root — exports the web UI into android/app/src/main/assets/web
node scripts/export-static.mjs

cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
gradle assembleDebug            # app/build/outputs/apk/debug/app-debug.apk
```

## Test

```bash
# live provider assertions run only when a key is present; the rest always run
CHOMUGIRI_NIM_KEY=nvapi-… gradle testDebugUnitTest
```

The suite boots the real server on a real socket and drives it over HTTP:
static serving, cache headers, client-route fallback, traversal rejection,
session gating, every error contract, and — with a key — the live NIM catalogue,
a streamed completion with its exact frame sequence, and a generated image.

## First run

The app asks for an NVIDIA NIM key (free at build.nvidia.com). You can skip it:
Pollinations models need no key. Change it later via ⋮ → API keys.

Terminal builds still need the bridge daemon on your machine — `npm run agent`,
expose it with ngrok or cloudflared, then paste the URL and token into
Settings → Terminal Bridge inside the app.
