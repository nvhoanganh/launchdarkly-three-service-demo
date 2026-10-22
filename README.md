# Three-team release lab

A live LaunchDarkly demonstration with three independent .NET services and an Express UI. Internet access and the selected environment’s server-side SDK key are required.

## Run

Copy the example configuration, then edit `.env` and set the existing server-side SDK keys for **launch-darkly-demo → Test/Production**:

```sh
cp .env.EXAMPLE .env
```

Fill these empty placeholders privately in `.env` (do not overwrite an existing `.env`):

```dotenv
ENV=test
LD_SDK_KEY_TEST=
LD_SDK_KEY_PROD=
```

Then run:

```sh
./run.sh
```

Open **http://127.0.0.1:4310**. Ctrl-C stops all four processes. Requires .NET 8+ SDK and Node 20.12+. First build restores NuGet/npm dependencies. The SDK key is loaded by the launcher, never displayed, and never passed to Express. `.env` is excluded from Git and the source ZIP. No management API key is needed to run the demo. The old `LD_MODE` setting is unused; there is no simulation mode.

## Read the code

```text
src/
  PaymentService/
    Program.cs              # payments-v2 → fee discount
    Contracts.cs
    PaymentService.csproj
  RiskService/
    Program.cs              # risk-v2 → high-value review
    Contracts.cs
    RiskService.csproj
  NotificationService/
    Program.cs              # notifications-v2 → detailed receipt
    Contracts.cs
    NotificationService.csproj
  DemoUI/
    server.mjs              # Express sends the chosen context to PaymentService
    public/                 # Toggle form, actual results and coverage matrix
```

Each service has one official LaunchDarkly .NET SDK client. Its request handler explicitly builds the context, evaluates its team's literal flag key, then runs an ordinary business `if/else`:

```csharp
var context = Context.Builder(request.Context.Key)
    .Kind("user")
    .Set("amount", (double)request.Context.Amount)
    .Set("combination", request.Context.Combination)
    .Build();

var evaluation = launchDarklyClient.BoolVariationDetail("payments-v2", context, false);
bool usePaymentV2 = evaluation.Value;

if (usePaymentV2)
{
    // Apply a 50% discount to the standard payment fee.
}
else
{
    // Charge the standard payment fee.
}
```

RiskService explicitly evaluates `"risk-v2"`; NotificationService explicitly evaluates `"notifications-v2"`. The false argument is the SDK's required default, not a separate application mode. Evaluation reasons remain visible so an SDK error cannot be mistaken for a verified flag decision.

| Service | Port | V1 | V2 |
|---|---:|---|---|
| PaymentService | 4311 | 2% payment fee | 50% discount on that fee |
| RiskService | 4312 | Approve | Review payments of AUD 1,000 or more |
| NotificationService | 4313 | Generic receipt | Amount, fee, savings, total and risk outcome |
| DemoUI | 4310 | — | Select context and display actual results |

Each .NET project builds and runs independently. There are no project references. The small `Contracts.cs` wire contract is duplicated to keep each project self-contained. Payment → Risk → Notification calls are real HTTP requests carrying the same stable context, request ID and accumulated results.

## Demonstrate the business difference

Use the AUD 1,250 AUD 1,250 payment:

| Payment version | Fee | Savings | Total |
|---|---:|---:|---:|
| V1 | AUD 25.00 | AUD 0.00 | AUD 1,275.00 |
| V2 | AUD 12.50 | AUD 12.50 | AUD 1,262.50 |

These are synthetic demo fees. No real payment or messaging system is called.

1. Submit `000`: standard fee, approve, generic receipt.
2. Enable Payment V2 (`100`): see the fee discount and lower total.
3. Add Risk V2 (`110`): high-value payment requires review.
4. Add Notification V2 (`111`): the receipt explains the review and itemizes the discounted fee.
5. Click **Test all 8 combinations**: seven combinations succeed; `011` shows the deliberate compatibility error.

The UI shows blue V2 and grey Default based on actual evaluations. The matrix displays actual On/Off values and business outputs. Untested rows show requested values labelled Requested, never a pass. A row is Verified only if evaluations, fee/savings/total, risk decision and receipt match, with no SDK error. Changing amount clears previous table evidence.

The toggles set the `combination` context attribute; they do not edit global flags or override LaunchDarkly's decisions. The context kind is `user`, with `key`, `amount`, `combination`. The synthetic key stays stable as combinations change; each journey has a separate request ID.

## Existing flag rules

Project **launch-darkly-demo**, environment **test**. Boolean flags have true variation 0, false variation 1; off variation and fallthrough are false. For kind `user`, ordered rules are:

1. `user.combination in [...]` → true.

| Flag | True combination values |
|---|---|
| payments-v2 | 100, 101, 110, 111 |
| risk-v2 | 010, 011, 110, 111 |
| notifications-v2 | 001, 011, 101, 111 |

For your own LaunchDarkly project, create these three boolean flags, enable targeting, and configure the rules below. Use that environment’s server-side SDK key. In the original demo account the flags already exist; do not rerun creation tooling for them. No prerequisites are used, so all combinations can be exercised. For an operational same-context rollback, an authorized operator changes targeting and repeats the unchanged request after SDK propagation. Such changes are not atomic across clients/services.

## Curl / independent services

```sh
curl -s localhost:4310/api/demo -H 'Content-Type: application/json' \
  -d '{"paymentsV2":true,"riskV2":false,"notificationsV2":true}' \
  | python3 -m json.tool
```

For separate terminals, supply LD_SDK_KEY in each .NET terminal's environment, then run:

```sh
dotnet run --project src/PaymentService
dotnet run --project src/RiskService
dotnet run --project src/NotificationService
# UI terminal
cd src/DemoUI && npm start
```

The root launcher handles `.env` loading for the one-command flow.

## Verification

With `./run.sh` already running:

```sh
npm test
node scripts/test-combinations.mjs
```

The integration suite calls the running live demo; it does not load SDK credentials, change flags, start replacement processes or stop your demo. It verifies six payment amounts across all eight combinations, explicit flag keys, business outcomes, stable propagated contexts, distinct service processes, 60 concurrent requests and invalid inputs. Pure coverage-verifier tests use fictional responses and check that incorrect fees, receipts or SDK fallback errors fail verification.

Flags select logic already deployed in the binaries. They do not deploy code or replace compatible HTTP contracts. This local synthetic demo omits production authentication, persistence and real financial/messaging integrations.

## Packaging

```sh
python3 scripts/package-demo.py
```

Creates `../three-team-demo.zip` from an explicit allowlist, excluding `.env`, `.env*`, credentials, node_modules, .NET bin/obj, logs and legacy code. Earlier Node source is archived outside this project in `../previous-node-demo` and is not executed or packaged.

Official SDK guidance: https://launchdarkly.com/docs/sdk/server-side/dotnet . Package: LaunchDarkly.ServerSdk 8.17.2.

### Deliberate failure: 011
Payment Default + Risk V2 + Notification V2 returns HTTP 500 with a visible compatibility error. This intentionally seeded demo dependency is checked against actual SDK evaluations, not requested toggles. Enable Payment V2 (111), disable Risk (001), or disable Notification (010) to recover. No real receipt is sent.

## Request animation
Submit payment replays the actual returned trace across Web UI → Payment → Risk → Notification → Response. Each service box highlights its evaluated Default or V2 branch. The response box shows success or the deliberate 011 compatibility error. This is a visual replay, not live per-service telemetry. Reduced-motion preferences skip animation delays.

The amount selector sends a numeric `amount` (AUD 50, 500, 999, 1000, 1250 or 5000) in the stable context. PaymentService uses it to calculate fees; Risk V2 approves amounts below AUD 1,000 and requests review at or above AUD 1,000. Risk V1 retains baseline approval. No scenario label determines the amount.

## Live service logs
Each service box has an Application logs panel, expanded by default. SSE streams synthetic request IDs, amounts, evaluated flags and reasons directly from each .NET service through Express. Panels retain the latest 100 entries in memory and preserve their expanded state during replay. They show new application events while connected, not historical console/SDK output. Streams reconnect automatically and disconnect when the page closes.

## Journey guardrail measurements

PaymentService enqueues two numeric LaunchDarkly events once per valid journey attempt,
using the existing `user` context and SDK client:

- `payment-journey-error`: 0 for a successful response, 1 for HTTP errors or exceptions.
- `payment-journey-duration-ms`: elapsed service-journey milliseconds, including downstream
  failures/timeouts. This excludes browser and Express overhead.

Both metric definitions average events per `user` context and then average those context
values, lower is better, excluding contexts with no events. Repeated synthetic context keys
mean the error metric is a mean per-context error rate, not global errors divided by requests.
Tracking uses the numeric SDK argument, remains asynchronous, and does not flush per request.
Invalid requests rejected before context validation emit neither measurement. Telemetry
failures do not replace the original journey response. Existing prerequisite evaluations
supply master flag exposure; no extra master evaluation is added.

Run isolated checks without live traffic:

```sh
dotnet run --project test/JourneyMetrics.Tests/JourneyMetrics.Tests.csproj
node --test test/coverage.test.mjs
```

A running demo must be restarted separately to load a new build. Creating metrics alone
does not validate event ingestion or start a guarded rollout. The deliberate `011` fault
remains unchanged and does not create a regression in the coordinated `000`/`111` journey.

## Prod/Test UI and guarded-release traffic

`ENV=test` is the safe default. `ENV=prod` enables a clearly synthetic HTTP 500 on
approximately 20% of otherwise successful valid **actual all-V2** payment journeys, after all three services
have returned. Health, logs and static requests are never faulted. Failed journeys retain
all service traces/diagnostics and emit the same exactly-once error/duration measurements.
Existing downstream errors and the deliberate 011 incompatibility remain unchanged.

The launcher selects `LD_SDK_KEY_TEST` for Test and `LD_SDK_KEY_PROD` for Prod, passing
only the selected value to services as their runtime `LD_SDK_KEY`. Missing/empty selected
keys fail before builds or startup; there is no fallback to an old generic `LD_SDK_KEY`.
Use keys from the matching LaunchDarkly environment; never paste them into browser controls
or k6. No credential is created or changed by mode selection.
Choose demo mode per run with `bash run.sh test` or `bash run.sh prod`; neither edits
`.env`. Precedence: positional argument, existing process `ENV`, `.env` `ENV`, then safe
default Test. With no argument, `bash run.sh` preserves the existing configuration behavior.
Arguments must be exactly `test` or `prod`; invalid or extra arguments fail before builds
or startup. Mode selects demo behavior and the corresponding named SDK key. The environment that
key belongs to is the actual LaunchDarkly environment.

Test and actual V1 journeys receive no injected faults. All three actual evaluated decisions
must be V2; requested UI toggles do not determine eligibility. No extra master evaluation
is added. `ENV=prod` is the only setting needed to enable this candidate-specific fault.

The badge reads the running PaymentService configuration through `/api/config`; unknown
or unavailable configuration is labelled UNKNOWN rather than guessing Test. The request
preview shows context kind `user`; returned context/trace shows the actual stable key.
The full current user ID remains visible beside the controls. In Prod, **Randomize user** chooses a fresh synthetic key, stable until clicked again.
Submit to see the actual evaluated V1/OFF, V2/ON, or mixed result. Randomizing never forces
ON. Test retains its original stable coverage identities and all eight combinations.
In Test, expand the collapsed **Test Harness** accordion inside Web UI to choose toggles;
it is hidden in Prod. Amount, Submit payment and the current user ID stay in Web UI.

### k6 from fish (run manually)

In your fish terminal, check that k6 is already installed:

```fish
cd /Users/anthonynguyen/source/LaunchDarkly/three-team-demo
k6 version
```

If unavailable, install it separately before continuing. Ensure `LD_SDK_KEY_PROD` in `.env` belongs to the intended LaunchDarkly
Production environment (`LD_SDK_KEY_TEST` for Test). Do not print or pass keys to k6. **Do not `source .env` into fish**; the launcher reads it.

Start the demo in that terminal (stop an existing instance first if needed):

```fish
bash run.sh prod
# Or independent Test demo mode:
# bash run.sh test
# No argument uses existing ENV configuration:
# bash run.sh
```

Confirm the UI at http://localhost:4310 shows Prod. In a **second fish terminal**:

```fish
cd /Users/anthonynguyen/source/LaunchDarkly/three-team-demo
k6 run scripts/guarded-release.k6.js
# Same bounded defaults, explicitly set for this command only:
env RATE=2 DURATION=30s k6 run scripts/guarded-release.k6.js
# Guarded-release sample: 10 journeys/second for 5 minutes, 20 ready VUs, cap 50:
env RATE=10 DURATION=5m PRE_ALLOCATED_VUS=20 MAX_VUS=50 k6 run scripts/guarded-release.k6.js
```

Supported script options are `RATE` (requests/second), `DURATION`, `BASE_URL`,
`PRE_ALLOCATED_VUS`, and `MAX_VUS` (positive integers; max must be at least preallocated).
Defaults are 2 requests/second for 30 seconds (about 60 journeys), 2 allocated virtual
users, maximum 4. Only localhost/127.0.0.1 on the demo endpoint is allowed. Ctrl-C stops
k6 early; Ctrl-C in the first terminal stops the demo. These commands do not change a
LaunchDarkly rollout.

The larger run targets about **3,000 distinct user contexts**, not 3,000 VUs. VUs are
concurrent workers reused for iterations; every iteration creates a new key. Twenty ready
VUs provide headroom at 10/s for roughly two-second journeys, with a bounded maximum of
50 if more concurrency is needed. Watch `dropped_iterations` and local CPU/latency: the
rate is a target, not a guarantee. At a constant 5% allocation, 3,000 users yield about
150 V2 contexts on average (roughly 30 injected failures at 20%); neither the counts nor
a guarded rollback/statistical conclusion are guaranteed. If allocation changes during
the run, the candidate share changes too.

Each request uses a fresh synthetic **user** context key, shared across all three services
and metric events. Requested toggles do not force ON: actual SDK evaluations decide the
cohort. Only actual all-V2 journeys in Prod receive approximately 20% synthetic 500s;
V1 and Test receive no injected faults. The deliberate Test 011 failure is unchanged.

Expect `http_reqs` near the planned count, response-time stats in `http_req_duration`,
and passing `checks` for successful responses or recognized synthetic 500s. Those 500s
still count in `http_req_failed`. At a 5% V2 allocation, 60 unique users yield only about
3 V2 users on average, so zero injected errors is plausible; the overall expected injected
error rate is about 1%, not 20%. Allocation and faults are random, and small samples are
insufficient for reliable guarded-rollout conclusions. Check `dropped_iterations` if the
configured VU cap cannot sustain the requested rate; do not assume every planned request ran.

In LaunchDarkly project `launch-darkly-demo`, open **Metrics**:
[error](https://app.launchdarkly.com/projects/launch-darkly-demo/metrics/payment-journey-error/details)
and [duration](https://app.launchdarkly.com/projects/launch-darkly-demo/metrics/payment-journey-duration-ms/details).
Use their event/activity view where available to confirm incoming events, then inspect the
existing Production guarded rollout's monitoring results. Metrics use mean values per
user context; k6's aggregate HTTP stats are not the rollout's cohort comparison.

If no events appear, allow SDK delivery/processing time and check service logs, SDK
connectivity, exact event keys and context kind `user`. If the wrong cohort/environment
appears, verify the running Prod badge, actual returned trace and matching SDK-key
environment privately; changing mode requires stopping and starting with `bash run.sh test` or `bash run.sh prod`.
The mode selects its named key; an incorrectly assigned key still points at the wrong
LaunchDarkly environment. Do not change the rollout just to troubleshoot telemetry.
No load test has been run for you.

Offline checks (no journey traffic):

```sh
node --test test/demo-context.test.mjs test/coverage.test.mjs
dotnet run --project test/JourneyMetrics.Tests/JourneyMetrics.Tests.csproj
```
