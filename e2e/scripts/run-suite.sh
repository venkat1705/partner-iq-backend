#!/usr/bin/env bash
# Restart backend (memory == MySQL), then run the coupon Playwright suite. Args are passed to playwright.
set -u
cd "$(dirname "$0")/.."
./scripts/restart-backend.sh >/dev/null || exit 1
PW_CHROMIUM="${PW_CHROMIUM:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}" npx playwright test "$@"
