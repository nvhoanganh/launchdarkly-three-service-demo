#!/bin/sh
set -eu
cd "$(dirname "$0")"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
for service in PaymentService RiskService NotificationService; do
  dotnet build "src/$service/$service.csproj" --nologo --verbosity quiet
done
if [ ! -d src/DemoUI/node_modules ]; then
  (cd src/DemoUI && npm ci --no-audit --no-fund)
fi
exec node scripts/start-demo.mjs
