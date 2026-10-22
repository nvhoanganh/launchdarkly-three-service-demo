#!/bin/sh
set -eu
# Validate before builds, dependency installation or service startup.
if [ "$#" -gt 1 ]; then
  echo "Usage: bash run.sh [test|prod]" >&2
  exit 2
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    test|prod) export ENV="$1" ;;
    *) echo "Usage: bash run.sh [test|prod]" >&2; exit 2 ;;
  esac
fi
cd "$(dirname "$0")"
node scripts/demo-environment.mjs
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
for service in PaymentService RiskService NotificationService; do
  dotnet build "src/$service/$service.csproj" --nologo --verbosity quiet
done
if [ ! -d src/DemoUI/node_modules ]; then
  (cd src/DemoUI && npm ci --no-audit --no-fund)
fi
exec node scripts/start-demo.mjs
