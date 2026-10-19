#!/bin/bash
set -u

# Windows/dev machines without the buf CLI cannot run proto lint; skip
# gracefully instead of failing the whole build (CI still runs buf).
if ! command -v buf >/dev/null 2>&1; then
  echo "buf CLI not installed; skipping proto lint."
  exit 0
fi

buf lint

if ! buf format -w --exit-code; then
  echo Proto files were formatted
fi

if grep -rn "rpc .*[A-Z][A-Z].*[(]" --include="*.proto"; then
  # See https://github.com/cline/cline/pull/7054
  echo Error: Proto RPC names cannot contain repeated capital letters
  exit 1
fi

