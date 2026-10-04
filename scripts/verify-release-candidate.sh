#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="release/ai-native-runtime-v2.0-rc1"
EXPECTED_SHA="f11deb61cf6013adfe84fd1b032f63904aab25e3"

git fetch origin "$EXPECTED_BRANCH" --quiet
actual_sha="$(git rev-parse FETCH_HEAD)"

if [ "$actual_sha" != "$EXPECTED_SHA" ]; then
  echo "RELEASE_CANDIDATE_MOVED expected=$EXPECTED_SHA actual=$actual_sha" >&2
  exit 1
fi

for workflow in   37182998655   37182998665   37182998699   37182998698
do
  test -n "$workflow"
done

echo "RELEASE_CANDIDATE_PIN_PASS branch=$EXPECTED_BRANCH sha=$EXPECTED_SHA"
