# Three-team release lab

A live LaunchDarkly demonstration with three independent .NET services and an Express UI. Internet access and the production environment SDK key are required.

## Run

Create a local `.env` file and put the server-side SDK key for **launch-darkly-demo → production** in the local `.env` file:

```dotenv
LD_SDK_KEY=your-server-side-sdk-key
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
    .Kind("demo")
    .Set("team", request.Context.Team)
    .Set("cohort", request.Context.Cohort)
    .Set("scenario", request.Context.Scenario)
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

Use the AUD 1,250 high-value scenario:

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

The UI shows blue V2 and grey Default based on actual evaluations. The matrix displays actual On/Off values and business outputs. Untested rows show requested values labelled Requested, never a pass. A row is Verified only if evaluations, fee/savings/total, risk decision and receipt match, with no SDK error. Changing scenario/cohort clears previous table evidence.

The toggles set the `combination` context attribute; they do not edit global flags or override LaunchDarkly's decisions. The context kind is `demo`, with `key`, `team`, `cohort`, `scenario`, `combination`. The synthetic key stays stable as combinations change; each journey has a separate request ID.

## Existing flag rules

Project **launch-darkly-demo**, environment **production**. Boolean flags have true variation 0, false variation 1; off variation and fallthrough are false. For kind `demo`, ordered rules are:

1. `cohort in [rollback]` → false.
2. `cohort in [test, release]` AND `combination in [...]` → true.

| Flag | True combination values |
|---|---|
| payments-v2 | 100, 101, 110, 111 |
| risk-v2 | 010, 011, 110, 111 |
| notifications-v2 | 001, 011, 101, 111 |

For your own LaunchDarkly project, create these three boolean flags, enable targeting, and configure the rules below. Use that environment’s server-side SDK key. In the original demo account the flags already exist; do not rerun creation tooling for them. No prerequisites are used, so all combinations can be exercised. Selecting the rollback cohort demonstrates its baseline targeting rule; it does not change flag configuration. For an operational same-context rollback, an authorized operator changes targeting and repeats the unchanged request after SDK propagation. Such changes are not atomic across clients/services.

## Curl / independent services

```sh
curl -s localhost:4311/demo -H 'X-Demo-User: team-risk' | python3 -m json.tool
```

Profiles: baseline=000; team-payments=100; team-risk=110; team-notifications=111; released=111/release cohort; rollback=111/rollback cohort.

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

The integration suite calls the running live demo; it does not load SDK credentials, change flags, start replacement processes or stop your demo. It verifies both payment scenarios across all eight combinations, explicit flag keys, business outcomes, stable propagated contexts, distinct service processes, 60 concurrent team requests, rollback-cohort behavior, invalid inputs and the curl endpoint. Pure coverage-verifier tests use fictional responses and check that incorrect fees, receipts or SDK fallback errors fail verification.

Flags select logic already deployed in the binaries. They do not deploy code or replace compatible HTTP contracts. This local synthetic demo omits production authentication, persistence and real financial/messaging integrations.

## Packaging

```sh
python3 scripts/package-demo.py
```

Creates `../three-team-demo.zip` from an explicit allowlist, excluding `.env`, `.env*`, credentials, node_modules, .NET bin/obj, logs and legacy code. Earlier Node source is archived outside this project in `../previous-node-demo` and is not executed or packaged.

Official SDK guidance: https://launchdarkly.com/docs/sdk/server-side/dotnet . Package: LaunchDarkly.ServerSdk 8.17.2.

### Deliberate failure: 011
Payment Default + Risk V2 + Notification V2 returns HTTP 422 with a visible compatibility error. This intentionally seeded demo dependency is checked against actual SDK evaluations, not requested toggles. Enable Payment V2 (111), disable Risk (001), or disable Notification (010) to recover. No real receipt is sent.
