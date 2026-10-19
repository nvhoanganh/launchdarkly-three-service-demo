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
    sdkReady = launchDarklyClient.Initialized,
    processId = Environment.ProcessId
}));

app.MapPost("/process", ProcessJourney);

// Curl-friendly profiles use the same HTTP journey as the UI.
app.MapGet("/demo", async (HttpRequest httpRequest, HttpClient httpClient, CancellationToken cancellationToken) =>
{
    string user = httpRequest.Headers["X-Demo-User"].FirstOrDefault() ?? "baseline";
    var profile = user switch
    {
        "baseline" => (Team: "payments", Combination: "000", Cohort: "test"),
        "team-payments" => (Team: "payments", Combination: "100", Cohort: "test"),
        "team-risk" => (Team: "risk", Combination: "110", Cohort: "test"),
        "team-notifications" => (Team: "notifications", Combination: "111", Cohort: "test"),
        "released" => (Team: "payments", Combination: "111", Cohort: "release"),
        "rollback" => (Team: "payments", Combination: "111", Cohort: "rollback"),
        _ => (Team: "", Combination: "", Cohort: "")
    };

    if (profile.Team == "")
    {
        return Results.BadRequest(new { error = "Unknown synthetic X-Demo-User profile." });
    }

    var request = new JourneyRequest
    {
        Context = new DemoContext(
            $"synthetic-{user}", profile.Team, profile.Cohort, "high-value", profile.Combination)
    };

    return await ProcessJourney(request, httpClient, cancellationToken);
});


async Task<IResult> ProcessJourney(JourneyRequest request, HttpClient httpClient, CancellationToken cancellationToken)
{
    if (request.Context is null || !request.Context.IsValid() || request.Data is null || request.Trace is null)
    {
        return Results.BadRequest(new { error = "Use a valid synthetic demo context." });
    }

    // Every service reconstructs the SAME LaunchDarkly context from the HTTP request.
    // Combination is a targeting attribute; it never overrides a live flag value.
    var context = Context.Builder(request.Context.Key)
        .Kind("demo")
        .Set("team", request.Context.Team)
        .Set("cohort", request.Context.Cohort)
        .Set("scenario", request.Context.Scenario)
        .Set("combination", request.Context.Combination)
        .Build();

    // This team owns this flag. Evaluate it for the request's context.
    var evaluation = launchDarklyClient.BoolVariationDetail("payments-v2", context, false);
    bool usePaymentV2 = evaluation.Value;

    request.Data.Amount = request.Context.Scenario == "high-value" ? 1250m : 50m;
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
        string body = await response.Content.ReadAsStringAsync(cancellationToken);
        return Results.Content(body, "application/json", statusCode: (int)response.StatusCode);
    }
    catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
    {
        return Results.Json(new { error = "RiskService is unavailable or timed out." }, statusCode: 502);
    }
}

app.Run();
