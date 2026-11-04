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
./gradlew assembleRelease --no-daemon   # signé si la clé est configurée, sinon non signé (contrôle de la minification)
ls -la app/build/outputs/apk/*/
