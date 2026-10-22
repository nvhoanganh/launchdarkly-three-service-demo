using System.Diagnostics;

namespace PaymentService;

public static class JourneyMetrics
{
    public static async Task<IResult> Measure(Func<Task<IResult>> journey,
        Action<double, double> record)
    {
        var timer = Stopwatch.StartNew();
        double error = 1;
        try
        {
            var result = await journey();
            var status = (result as IStatusCodeHttpResult)?.StatusCode ?? 200;
            error = status >= 400 ? 1 : 0;
            return result;
        }
        finally
        {
            timer.Stop();
            record(error, timer.Elapsed.TotalMilliseconds);
        }
    }
}
