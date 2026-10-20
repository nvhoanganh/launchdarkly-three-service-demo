using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;

// In-memory synthetic demo logs only. Each browser gets its own bounded stream.
public static class ApplicationLogs
{
    private static readonly ConcurrentDictionary<Guid, Channel<string>> Subscribers = new();

    public static void Write(string service, string requestId, string message, string level = "info")
    {
        string json = JsonSerializer.Serialize(new { service, requestId, message, level, time = DateTimeOffset.UtcNow });
        foreach (var subscriber in Subscribers.Values) subscriber.Writer.TryWrite(json);
    }

    public static async Task Stream(HttpContext context)
    {
        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache";
        var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(100)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });
        Guid id = Guid.NewGuid();
        Subscribers[id] = channel;
        try
        {
            await context.Response.WriteAsync(": connected\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
            await foreach (string json in channel.Reader.ReadAllAsync(context.RequestAborted))
            {
                await context.Response.WriteAsync($"data: {json}\n\n", context.RequestAborted);
                await context.Response.Body.FlushAsync(context.RequestAborted);
            }
        }
        catch (OperationCanceledException) { }
        finally { Subscribers.TryRemove(id, out _); }
    }
}
