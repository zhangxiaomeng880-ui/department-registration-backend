#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TARGET_REF="f11deb61cf6013adfe84fd1b032f63904aab25e3"

echo "AI Native Runtime RC: ai-native-runtime-v2.0-rc1"
echo "Pinned commit: $TARGET_REF"

exec bash "$ROOT_DIR/scripts/deploy-runtime-vps.sh"
