using Microsoft.AspNetCore.Http;
using PaymentService;

foreach (var status in new[] { 200, 400, 500, 502 })
{
    var expected = Results.StatusCode(status);
    var records = new List<(double Error, double Duration)>();
    var result = await JourneyMetrics.Measure(async () =>
    {
        await Task.Yield();
        return expected;
    }, (error, duration) => records.Add((error, duration)));
    Check(ReferenceEquals(result, expected), "Original response is preserved");
    Check(records.Count == 1, "Exactly one measurement pair per response");
    Check(records[0].Error == (status >= 400 ? 1 : 0), "Status classification");
    Check(double.IsFinite(records[0].Duration) && records[0].Duration >= 0, "Finite elapsed milliseconds");
}

foreach (var exception in new Exception[] { new HttpRequestException(), new TaskCanceledException(), new InvalidOperationException() })
{
    var records = new List<(double Error, double Duration)>();
    Exception? observed = null;
    try
    {
        await JourneyMetrics.Measure(() => Task.FromException<IResult>(exception),
            (error, duration) => records.Add((error, duration)));
    }
    catch (Exception caught) { observed = caught; }
    Check(ReferenceEquals(observed, exception), "Original exception is preserved");
    Check(records.Count == 1 && records[0].Error == 1, "One failure measurement on exceptions and timeouts");
}
var contexts = new[] {
    new PaymentService.DemoContext("synthetic-payments-1250", 1250m, "111").ToLaunchDarklyContext(),
    new RiskService.DemoContext("synthetic-payments-1250", 1250m, "111").ToLaunchDarklyContext(),
    new NotificationService.DemoContext("synthetic-payments-1250", 1250m, "111").ToLaunchDarklyContext()
};
foreach (var context in contexts)
{
    Check(context.Kind.ToString() == "user", "All services use user contexts");
    Check(context.Key == "synthetic-payments-1250", "Stable key propagates across services");
    Check(context.GetValue("combination").AsString == "111", "Combination attribute preserved");
    Check(context.GetValue("cohort").IsNull && context.GetValue("team").IsNull, "Removed attributes absent");
    Check(context.Equals(contexts[0]), "All service evaluation and telemetry contexts match");
}
Console.WriteLine("Journey metric checks passed: success, HTTP errors, downstream exception, timeout, unexpected exception.");

static void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

Check(!DemoFailurePolicy.ShouldInject(null, true, 0), "Default test has no random faults");
Check(!DemoFailurePolicy.ShouldInject("test", true, 0), "Test never injects");
Check(!DemoFailurePolicy.ShouldInject("prod", false, 0), "Prod V1 never injects");
Check(DemoFailurePolicy.ShouldInject("prod", true, 0.199), "Prod actual V2 eligible");
Check(!DemoFailurePolicy.ShouldInject("prod", true, 0.2), "20 percent boundary");
Check(Enumerable.Range(0, 100).Count(i => DemoFailurePolicy.ShouldInject("prod", true, i / 100.0)) == 20,
    "Exactly twenty percent of uniform V2 samples selected");
