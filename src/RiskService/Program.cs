using LaunchDarkly.Sdk;
using LaunchDarkly.Sdk.Server;
using RiskService;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:4312");
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
    service = "RiskService",
    mode = "live",
    sdkReady = launchDarklyClient.Initialized,
    processId = Environment.ProcessId
}));

app.MapPost("/process", ProcessJourney);

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
    var evaluation = launchDarklyClient.BoolVariationDetail("risk-v2", context, false);
    bool useRiskV2 = evaluation.Value;

    decimal amount = request.Data.Amount;

    string behavior;
    if (useRiskV2)
    {
        request.Data.RiskDecision = amount >= 1000m ? "review" : "approve";
        request.Data.RiskPolicy = "Adaptive high-value review";
        behavior = "High-value payments require review";
    }
    else
    {
        request.Data.RiskDecision = "approve";
        request.Data.RiskPolicy = "Baseline approval";
        behavior = "Original approval policy";
    }

    request.Trace.Add(new ServiceDecision(
        "RiskService",
        "risk-v2",
        useRiskV2,
        behavior,
        evaluation.Reason.ToString(),
        Environment.ProcessId,
        request.Context));

    // Real HTTP boundary: pass the stable context and accumulated result downstream.
    try
    {
        using var response = await httpClient.PostAsJsonAsync(
            "http://127.0.0.1:4313/process", request, cancellationToken);

        // Preserve downstream status and diagnostics, including compatibility failures.
        string body = await response.Content.ReadAsStringAsync(cancellationToken);
        return Results.Content(body, "application/json", statusCode: (int)response.StatusCode);
    }
    catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
    {
        return Results.Json(new { error = "NotificationService is unavailable or timed out." }, statusCode: 502);
    }
}

app.Run();
