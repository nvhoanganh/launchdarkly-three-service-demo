using LaunchDarkly.Sdk;
using LaunchDarkly.Sdk.Server;
using NotificationService;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:4313");
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
    service = "NotificationService",
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
    var evaluation = launchDarklyClient.BoolVariationDetail("notifications-v2", context, false);
    bool useNotificationV2 = evaluation.Value;

    string behavior;
    if (useNotificationV2)
    {
        string outcome = request.Data.RiskDecision == "review" ? "awaiting review" : "approved";
        request.Data.Notification = FormattableString.Invariant(
            $"Payment {outcome}: {request.Data.Currency} {request.Data.Amount:F2}. Fee: AUD {request.Data.Fee:F2}; savings: AUD {request.Data.FeeDiscount:F2}; total: AUD {request.Data.Total:F2}.");
        behavior = "Detailed receipt includes fee, savings, total and review status";
    }
    else
    {
        request.Data.Notification = "Payment received";
        behavior = "Original generic payment receipt";
    }

    request.Trace.Add(new ServiceDecision(
        "NotificationService",
        "notifications-v2",
        useNotificationV2,
        behavior,
        evaluation.Reason.ToString(),
        Environment.ProcessId,
        request.Context));

    // Deliberate demo incompatibility, based on ACTUAL evaluated versions.
    // The new risk + receipt workflow requires the new payment implementation.
    bool oldPayment = request.Trace.Any(step => step.Service == "PaymentService" && !step.IsV2);
    bool newRisk = request.Trace.Any(step => step.Service == "RiskService" && step.IsV2);
    if (oldPayment && newRisk && useNotificationV2)
    {
        request.Error = "Demo compatibility error: Risk V2 + Notification V2 require Payment V2. Enable Payment V2 or roll back Risk or Notification.";
        request.Data.Notification = "Receipt not sent: incompatible service combination.";
        return Results.Json(request, statusCode: 422);
    }

    return Results.Ok(request);
}

app.Run();
