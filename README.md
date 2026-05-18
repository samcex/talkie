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

## Web — deploy (Vercel)

1. Push this repo to GitHub (already done).
2. In Vercel → **Add New → Project → talkie**.
3. The root `vercel.json` builds the Next.js app from `web/`.
4. Add the variables from `web/.env.local.example` in **Project Settings → Environment Variables**:
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `NEXT_PUBLIC_LIVEKIT_URL`
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
   - `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`
   - `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`
   - `ADMIN_EMAILS`
   - `DATABASE_URL` (Neon pooled Postgres connection string)
5. Deploy.

### Direct-call alert verification

After deploying, validate direct calls on real phones and at least one desktop
browser. Use two signed-in users that have each other saved or searchable.

1. Open Talkie as User A on one device and User B on another.
2. On both devices, open **Settings** and enable:
   - **Beep on incoming**
   - **Vibrate on incoming**
   - **Browser notifications**
3. When the browser asks for notification permission, choose **Allow**.
4. From User A, start a one-to-one call to User B.
5. Confirm User B sees the full-screen incoming call alert from:
   - the home page
   - `/settings`
   - an existing channel page
6. Confirm User B gets the audible ring, vibration if supported, browser
   notification, and flashing tab title.
7. Tap **Answer** and confirm both users land in the same direct channel.
8. Repeat the call and tap **Decline**. Confirm User A sees the declined or
   cancelled status.
9. Repeat the call and do not answer. Confirm User A sees the expired status
   after the pending call timeout.

If the incoming alert does not appear immediately, check that
`/api/calls/stream` is reachable on the deployed domain. The web app uses that
SSE route for near-real-time call updates and falls back to polling if streaming
is unavailable.

## Neon database

Talkie uses Neon Postgres when `DATABASE_URL` is configured. It stores:

- saved contacts per Clerk user
- pending direct-call alerts
- short-lived direct-call status records for answered, declined, and expired
  call feedback

Create a Neon project, copy the pooled connection string, and add it as
`DATABASE_URL` in Vercel. After deploy, sign in as an admin and open
`/api/db/init` once to verify the connection and create the tables.

The app also creates the schema lazily from API routes, so the initializer is
mainly a quick configuration check.

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
