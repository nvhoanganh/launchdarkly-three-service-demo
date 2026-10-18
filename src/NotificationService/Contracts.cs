namespace NotificationService;

// This small HTTP contract is deliberately duplicated so each project can build independently.
public sealed record DemoContext(
    string Key,
    string Team,
    string Cohort,
    string Scenario,
    string Combination)
{
    public bool IsValid() =>
        !string.IsNullOrWhiteSpace(Key) && Key.StartsWith("synthetic-") && Key.Length <= 100 &&
        new[] { "payments", "risk", "notifications" }.Contains(Team) &&
        new[] { "test", "release", "rollback" }.Contains(Cohort) &&
        new[] { "standard", "high-value" }.Contains(Scenario) &&
        Combination is { Length: 3 } && Combination.All(bit => bit is '0' or '1');
}

public sealed class JourneyRequest
{
    public string? Error { get; set; }
    public string RequestId { get; set; } = Guid.NewGuid().ToString();
    public DemoContext Context { get; set; } = new("synthetic-default", "payments", "test", "high-value", "000");
    public JourneyData Data { get; set; } = new();
    public List<ServiceDecision> Trace { get; set; } = [];
}

public sealed class JourneyData
{
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "AUD";
    public decimal StandardFee { get; set; }
    public decimal FeeDiscount { get; set; }
    public decimal Fee { get; set; }
    public decimal Total { get; set; }
    public string RiskDecision { get; set; } = "";
    public string RiskPolicy { get; set; } = "";
    public string Notification { get; set; } = "";
}

public sealed record ServiceDecision(
    string Service,
    string FlagKey,
    bool IsV2,
    string Behavior,
    string Reason,
    int ProcessId,
    DemoContext Context);
