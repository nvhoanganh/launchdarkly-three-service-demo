namespace PaymentService;

public static class DemoFailurePolicy
{
    public static string EnvironmentName(string? value) => value == "prod" ? "prod" : "test";
    public static bool ShouldInject(string? environment, bool actualCandidate, double sample) =>
        EnvironmentName(environment) == "prod" &&
        actualCandidate && sample >= 0 && sample < 0.2;
}
