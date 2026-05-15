# Talkie

Push-to-talk for teams. Hold a button, speak, release. Built on LiveKit.

## Stack

- **Web** — Next.js 16 + React 19 + Tailwind 4 + `livekit-client`
- **Android** — Kotlin + Jetpack Compose + `io.livekit:livekit-android` + foreground service
- **Backend (audio)** — LiveKit Cloud (managed SFU)
- **Backend (tokens)** — Next.js API route, signs LiveKit JWTs with API secret

```
talkie/
├── web/              Next.js app (UI + token API)
├── android/          Kotlin app (Compose UI + PTT service)
└── .github/workflows GitHub Actions (APK build)
```

## Web — local dev

1. Sign up at https://cloud.livekit.io, create a project, copy the API key, secret, and WSS URL.
2. Create `web/.env.local`:
   ```
   LIVEKIT_API_KEY=APIxxxxx
   LIVEKIT_API_SECRET=xxxxx
   NEXT_PUBLIC_LIVEKIT_URL=wss://yourproject.livekit.cloud
   ```
3. ```
   cd web
   npm install
   npm run dev
   ```
4. Open `http://localhost:3000` in two tabs, join the same channel, hold TALK.

## Web — deploy (Netlify)

1. Push this repo to GitHub (already done).
2. In Netlify → **Add new site → Import from Git → talkie**.
3. Build settings (Netlify auto-detects):
   - **Base directory**: `web`
   - **Build command**: `npm run build`
   - **Publish directory**: `web/.next`
4. Add the same three env vars (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL`) in **Site settings → Environment variables**.
5. Deploy.

## Android

The Kotlin app reads the token URL from `TALKIE_TOKEN_BASE_URL` Gradle property (defaults to `http://10.0.2.2:3000` for emulator → host loopback).

For a release build pointing at your deployed web URL:
```
cd android
./gradlew assembleRelease -PTALKIE_TOKEN_BASE_URL=https://your.netlify.app
```

For a debug build (no signing required):
```
./gradlew assembleDebug
```

Output APK: `android/app/build/outputs/apk/debug/app-debug.apk`

### Install

```
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to your phone and tap to install (enable "Install from unknown sources").

## CI

Every push to `main` builds a debug APK and uploads it as a workflow artifact. See `.github/workflows/android.yml`.

## Rotating LiveKit credentials

The `.env.local` file is gitignored. Rotate at any time via LiveKit Cloud dashboard → Settings → Keys.
