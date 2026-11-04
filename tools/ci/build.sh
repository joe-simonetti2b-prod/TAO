#!/usr/bin/env bash
# Build complet TAO (exécuté sur GitHub Actions)
set -euxo pipefail
node -v; npm -v; java -version
npm ci || npm install
npm run build:web
npx cap sync android
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon --stacktrace
if [ -n "${TAO_KEYSTORE:-}" ]; then ./gradlew assembleRelease --no-daemon; fi
ls -la app/build/outputs/apk/*/
