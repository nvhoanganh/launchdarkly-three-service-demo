using LaunchDarkly.Sdk;
using LaunchDarkly.Sdk.Server;
using PaymentService;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:4311");
builder.Services.AddSingleton(new HttpClient { Timeout = TimeSpan.FromSeconds(10) });

// One LaunchDarkly client for this service's lifetime.
string sdkKey = builder.Configuration["LD_SDK_KEY"]
    ?? throw new InvalidOperationException("Set LD_SDK_KEY in .env.");

using var launchDarklyClient = new LdClient(
    Configuration.Builder(sdkKey)
        .StartWaitTime(TimeSpan.FromSeconds(5))
        .Build());

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new
{
    service = "PaymentService",
    mode = "live",
    environment = DemoFailurePolicy.EnvironmentName(builder.Configuration["ENV"]),
    failureRate = 0.2,
    contextKind = "user",
    sdkReady = launchDarklyClient.Initialized,
    processId = Environment.ProcessId
}));

app.MapPost("/process", ProcessJourney);
app.MapGet("/logs", ApplicationLogs.Stream);

async Task<IResult> ProcessJourney(JourneyRequest request, HttpClient httpClient, CancellationToken cancellationToken)
{
    if (request.Context is null || !request.Context.IsValid() || request.Data is null || request.Trace is null)
    {
        return Results.BadRequest(new { error = "Use a valid synthetic demo context." });
    }

    // Every service reconstructs the SAME LaunchDarkly context from the HTTP request.
    // Combination is a targeting attribute; it never overrides a live flag value.
    var context = request.Context.ToLaunchDarklyContext();

    // One pair of measurements per valid journey, including downstream failures.
    return await JourneyMetrics.Measure(
        () => ProcessJourneyCore(request, httpClient, cancellationToken, context),
        (error, durationMs) =>
        {
            try
            {
                launchDarklyClient.Track("payment-journey-error", context, LdValue.Null, error);
                launchDarklyClient.Track("payment-journey-duration-ms", context, LdValue.Null, durationMs);
            }
            catch (Exception)
            {
                // Telemetry must never replace the journey's result or exception.
                app.Logger.LogWarning("Unable to enqueue journey guardrail measurements.");
            }
        });
}

async Task<IResult> ProcessJourneyCore(JourneyRequest request, HttpClient httpClient,
    CancellationToken cancellationToken, Context context)
{
    // This team owns this flag. Evaluate it for the request's context.
    var evaluation = launchDarklyClient.BoolVariationDetail("payments-v2", context, false);
    bool usePaymentV2 = evaluation.Value;

    request.Data.Amount = request.Context.Amount;
    request.Data.Currency = "AUD";

    // Both paths charge a transparent 2% standard fee; V2 introduces a 50% fee discount.
    request.Data.StandardFee = decimal.Round(request.Data.Amount * 0.02m, 2, MidpointRounding.AwayFromZero);

    string behavior;
    if (usePaymentV2)
    {
        request.Data.FeeDiscount = decimal.Round(request.Data.StandardFee * 0.50m, 2, MidpointRounding.AwayFromZero);
        request.Data.Fee = request.Data.StandardFee - request.Data.FeeDiscount;
        request.Data.Total = request.Data.Amount + request.Data.Fee;
        behavior = FormattableString.Invariant($"50% fee discount: AUD {request.Data.Fee:F2} fee; save AUD {request.Data.FeeDiscount:F2}");
    }
    else
    {
        request.Data.FeeDiscount = 0m;
        request.Data.Fee = request.Data.StandardFee;
        request.Data.Total = request.Data.Amount + request.Data.Fee;
        behavior = FormattableString.Invariant($"Standard 2% fee: AUD {request.Data.Fee:F2}; no discount");
    }

    ApplicationLogs.Write("PaymentService", request.RequestId,
        $"AUD {request.Context.Amount} | payments-v2 = {evaluation.Value} | {evaluation.Reason}");
    app.Logger.LogInformation(
        "Request {RequestId} | amount AUD {Amount} | flag {FlagKey} = {FlagValue} | reason {Reason}",
        request.RequestId, request.Context.Amount, "payments-v2", evaluation.Value, evaluation.Reason);

    request.Trace.Add(new ServiceDecision(
        "PaymentService",
        "payments-v2",
        usePaymentV2,
        behavior,
        evaluation.Reason.ToString(),
        Environment.ProcessId,
        request.Context));

    // Real HTTP boundary: pass the stable context and accumulated result downstream.
    try
    {
        using var response = await httpClient.PostAsJsonAsync(
            "http://127.0.0.1:4312/process", request, cancellationToken);

        // Preserve downstream status and diagnostics, including compatibility failures.
        if (!response.IsSuccessStatusCode)
        {
            ApplicationLogs.Write("PaymentService", request.RequestId,
                $"Downstream request failed: HTTP {(int)response.StatusCode}.", "error");
        }
        string body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            var completed = System.Text.Json.JsonSerializer.Deserialize<JourneyRequest>(body,
                new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
            bool candidate = completed?.Trace.Count == 3 && completed.Trace.All(step => step.IsV2);
            if (completed is not null && DemoFailurePolicy.ShouldInject(
                builder.Configuration["ENV"],
                candidate, Random.Shared.NextDouble()))
            {
                completed.Error = "Synthetic demo fault: injected HTTP 500 (20% Prod V2 policy). No real payment was made.";
                ApplicationLogs.Write("PaymentService", request.RequestId, completed.Error, "error");
                return Results.Json(completed, statusCode: 500);
            }
        }
        return Results.Content(body, "application/json", statusCode: (int)response.StatusCode);
    }
    catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
    {
        return Results.Json(new { error = "RiskService is unavailable or timed out." }, statusCode: 502);
    }
}

app.Run();
