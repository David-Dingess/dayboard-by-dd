using System.Net;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Dayboard.NowPlaying;

/*
 * The third thing this agent knows that a remote server cannot: how much of the
 * Claude subscription is left.
 *
 * It is here for the same reason Vitals is — the socket, the CORS allowlist, the
 * autostart task and the browser-side base URL all already exist and all already
 * point at 127.0.0.1:7343 — and for one reason of its own: the OAuth token this
 * needs sits in %USERPROFILE%\.claude\.credentials.json, which is a secret that
 * must never leave the machine. A remote process could not read it and should
 * not be trusted with it.
 *
 * WHY THE AGENT POLLS AND THE BROWSER DOES NOT. Everything else here is a sensor
 * the browser could in principle read as fast as it likes. This is a call to
 * somebody else's rate-limited API, and Anthropic 429s it hard. So the cadence
 * lives on this side: the agent asks slowly and holds the answer, /claude hands
 * back the held copy and makes NO upstream call, and the widget may then poll at
 * whatever rate suits the board — every 30s, on every reload, from three tabs at
 * once — without ever touching Anthropic. A fetch loop in the browser would
 * rate-limit itself out of existence within a day.
 */

/// <summary>What the board is allowed to say. Anything but Ok renders a sentence.</summary>
internal static class ClaudeState
{
    public const string Ok = "ok";
    /// <summary>No .credentials.json. Claude Code CLI has never been logged in here.</summary>
    public const string NoCredentials = "no-credentials";
    /// <summary>Refresh token itself has run out (29 days). Only a human can fix this.</summary>
    public const string Expired = "expired";
    public const string RateLimited = "rate-limited";
    public const string Error = "error";
    /// <summary>Started up, first call not back yet.</summary>
    public const string Looking = "looking";
}

/// <summary>
/// One bar. Deliberately a near-passthrough of an entry in the API's `limits`
/// array rather than a field per window.
///
/// THE TOP-LEVEL KEYS OF THAT RESPONSE ARE A TRAP. Alongside five_hour and
/// seven_day it carries a drifting set of rotating codenames — nimbus_quill,
/// tangelo, iguana_necktie, cinder_cove, copper_kite, amber_ladder, juniper_tide
/// — nearly all null, and Fable is not among them under any guessable name. The
/// `limits` array is where the real numbers are, and it is self-describing:
/// every entry names its own kind, its own percent, its own severity, and (for a
/// per-model cap) its own display name. Passing it through means a bucket
/// Anthropic adds next month shows up on the board by itself, with the right
/// label, instead of silently missing because we hardcoded a codename that has
/// since rotated.
/// </summary>
internal sealed record ClaudeLimit(
    /// <summary>"session", "weekly_all", "weekly_scoped", or whatever comes next.</summary>
    string Kind,
    /// <summary>"session" or "weekly". The board groups on this, not on Kind.</summary>
    string? Group,
    /// <summary>The model name for a scoped cap — "Fable". Null for the whole-plan windows.</summary>
    string? Label,
    /// <summary>0–100. NOT 0–1, whatever the blog posts say.</summary>
    double Percent,
    /// <summary>The server's own judgement: "normal", "warning", "critical".</summary>
    string? Severity,
    /// <summary>ISO-8601 UTC, or null for a window that has never started.</summary>
    string? ResetsAt,
    bool IsActive);

/// <summary>What /claude serves. Immutable, so Read() can hand it straight out.</summary>
internal sealed record ClaudeSnapshot(
    string State,
    /// <summary>Unix ms of the last SUCCESSFUL upstream read, so the board can age it honestly.</summary>
    long? FetchedAt,
    /// <summary>"max", "pro". Straight off the credentials file.</summary>
    string? Plan,
    /// <summary>"default_claude_max_5x". Ditto.</summary>
    string? Tier,
    IReadOnlyList<ClaudeLimit> Limits,
    /// <summary>Why State is not Ok. Shown verbatim, so write it for a person.</summary>
    string? Note)
{
    public static ClaudeSnapshot Empty(string state, string? note = null) =>
        new(state, null, null, null, Array.Empty<ClaudeLimit>(), note);
}

/// <summary>
/// Reads the Claude subscription's rate-limit windows and holds the last good
/// answer.
///
/// Shaped on Vitals: its own cadence, a lock-guarded snapshot, Read() hands back
/// a copy, and every failure sets a state rather than throwing. The board must
/// stay up when Anthropic is down.
///
/// BOTH ENDPOINTS ARE UNDOCUMENTED. /api/oauth/usage and its
/// `anthropic-beta: oauth-2025-04-20` header are what Claude Code itself uses,
/// and the beta string is versioned, so this can break on any release with no
/// warning. That is survivable precisely because it is quarantined here: a 404
/// or a shape change sets State = error and costs the board one widget.
/// </summary>
internal sealed class Claude : IDisposable
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private const string UsageUrl = "https://api.anthropic.com/api/oauth/usage";
    /// <summary>
    /// Read out of claude.exe itself, not off a blog. Every write-up on this says
    /// console.anthropic.com; the binary says platform.claude.com, and the binary
    /// is the one making the call that works.
    /// </summary>
    private const string TokenUrl = "https://platform.claude.com/v1/oauth/token";
    /// <summary>Claude Code's public OAuth client. Also confirmed present in the binary.</summary>
    private const string ClientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
    private const string OAuthBeta = "oauth-2025-04-20";

    /// <summary>
    /// Five minutes while you are at the desk. The tray monitors converged on
    /// 5–7 and none of them get 429ed at it; the endpoint's aggression is aimed
    /// at per-second pollers, not this.
    /// </summary>
    private static readonly TimeSpan ActivePoll = TimeSpan.FromMinutes(5);
    /// <summary>
    /// While nobody has touched the machine in 10 minutes. NOT stopped: the 5-hour
    /// window keeps refilling overnight whether or not anyone is watching, and a
    /// board that resumes with a four-hour-old number is worse than one that
    /// asked twice an hour.
    /// </summary>
    private static readonly TimeSpan IdlePoll = TimeSpan.FromMinutes(20);
    private static readonly TimeSpan IdleAfter = TimeSpan.FromMinutes(10);
    /// <summary>First backoff step on a 429; doubles to MaxBackoff.</summary>
    private static readonly TimeSpan MinBackoff = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(60);
    /// <summary>
    /// Refresh this far ahead of expiry. The access token lives 8 hours, so this
    /// costs one extra call a day and removes every race with a poll that starts
    /// valid and arrives expired.
    /// </summary>
    private static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(10);
    /// <summary>
    /// How soon after a window's reset to look again. A bar that empties at 4am
    /// and still reads 91% at 4:20 is the one thing that would make you stop
    /// believing the board.
    /// </summary>
    private static readonly TimeSpan AfterReset = TimeSpan.FromSeconds(45);

    private readonly object _gate = new();
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private readonly CancellationTokenSource _stop = new();
    private ClaudeSnapshot _snapshot = ClaudeSnapshot.Empty(ClaudeState.Looking);
    private TimeSpan _backoff = TimeSpan.Zero;
    private Task? _loop;

    public Claude()
    {
        // Claude Code's own UA. The endpoint is meant for this client, and there is
        // no reason to make ourselves look like a different one.
        _http.DefaultRequestHeaders.Add("User-Agent", "claude-cli (dayboard-nowplaying)");
        _http.DefaultRequestHeaders.Add("anthropic-beta", OAuthBeta);
    }

    /// <summary>Where the CLI keeps its token. CLAUDE_CONFIG_DIR is what the CLI honours.</summary>
    public static string CredentialsPath()
    {
        var dir = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
        if (string.IsNullOrWhiteSpace(dir))
            dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude");
        return Path.Combine(dir, ".credentials.json");
    }

    public bool Available => File.Exists(CredentialsPath());

    public void Start() => _loop = Task.Run(() => LoopAsync(_stop.Token));

    /// <summary>The latest reading. The record is immutable, so this is a safe handout.</summary>
    public ClaudeSnapshot Read()
    {
        lock (_gate) return _snapshot;
    }

    public static string ToJson(ClaudeSnapshot snapshot) => JsonSerializer.Serialize(snapshot, Json);

    private async Task LoopAsync(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            var wait = await PollAsync(cancel);
            try { await Task.Delay(wait, cancel); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>One upstream read. Returns how long to wait before the next one.</summary>
    private async Task<TimeSpan> PollAsync(CancellationToken cancel)
    {
        string token;
        try
        {
            var creds = ReadCredentials();
            if (creds is null)
            {
                Set(ClaudeSnapshot.Empty(
                    ClaudeState.NoCredentials,
                    "no Claude credentials — run `claude` once and log in"));
                // Nothing to poll and nothing that will change on its own. Look
                // again on the idle cadence in case you log in mid-session.
                return IdlePoll;
            }

            token = await EnsureFreshAsync(creds.Value, cancel);
        }
        catch (RefreshExpiredException)
        {
            Set(ClaudeSnapshot.Empty(
                ClaudeState.Expired, "Claude login expired — run `claude` once to sign back in"));
            return IdlePoll;
        }
        catch (Exception ex)
        {
            Keep(ClaudeState.Error, $"could not refresh the Claude token: {ex.Message}");
            return Backoff();
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, UsageUrl);
            request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + token);
            using var response = await _http.SendAsync(request, cancel);

            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                Keep(ClaudeState.RateLimited, "Anthropic is rate-limiting the usage check");
                return Backoff();
            }
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                // The token was fresh a moment ago, so this is not expiry — it is
                // a scope or a revocation, and only a human can clear it.
                Keep(ClaudeState.Expired, "Claude rejected the token — run `claude` once to sign back in");
                return IdlePoll;
            }
            if (!response.IsSuccessStatusCode)
            {
                Keep(ClaudeState.Error, $"usage check returned HTTP {(int)response.StatusCode}");
                return Backoff();
            }

            var body = await response.Content.ReadFromJsonAsync<JsonNode>(cancellationToken: cancel);
            var limits = ParseLimits(body);
            var (plan, tier) = PlanOf();

            _backoff = TimeSpan.Zero;
            Set(new ClaudeSnapshot(
                ClaudeState.Ok, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), plan, tier, limits, null));

            return NextAfter(limits);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            return IdlePoll;
        }
        catch (Exception ex)
        {
            Keep(ClaudeState.Error, $"could not reach Anthropic: {ex.Message}");
            return Backoff();
        }
    }

    /// <summary>
    /// The `limits` array, passed through nearly whole. Falls back to the
    /// top-level five_hour/seven_day pair if a future response drops the array —
    /// those two keys predate it and are the likeliest thing to survive it.
    /// </summary>
    private static List<ClaudeLimit> ParseLimits(JsonNode? body)
    {
        var limits = new List<ClaudeLimit>();
        if (body is null) return limits;

        if (body["limits"] is JsonArray array)
        {
            foreach (var entry in array)
            {
                if (entry is null) continue;
                var kind = entry["kind"]?.GetValue<string>();
                if (string.IsNullOrEmpty(kind)) continue;
                limits.Add(new ClaudeLimit(
                    kind,
                    entry["group"]?.GetValue<string>(),
                    entry["scope"]?["model"]?["display_name"]?.GetValue<string>(),
                    Percent(entry["percent"]),
                    entry["severity"]?.GetValue<string>(),
                    entry["resets_at"]?.GetValue<string>(),
                    entry["is_active"]?.GetValue<bool>() ?? false));
            }
            if (limits.Count > 0) return limits;
        }

        foreach (var (key, kind) in new[] { ("five_hour", "session"), ("seven_day", "weekly_all") })
        {
            if (body[key] is not JsonObject window) continue;
            limits.Add(new ClaudeLimit(
                kind,
                kind == "session" ? "session" : "weekly",
                null,
                Percent(window["utilization"]),
                null,
                window["resets_at"]?.GetValue<string>(),
                false));
        }
        return limits;
    }

    /// <summary>Both `percent` and `utilization` come back as 0–100, integer or double.</summary>
    private static double Percent(JsonNode? node)
    {
        if (node is null) return 0;
        try { return Math.Clamp(node.GetValue<double>(), 0, 100); }
        catch { return 0; }
    }

    /// <summary>
    /// Sooner of the normal cadence and just after the next window resets, so a
    /// bar that empties at 4am is right by 4:01 rather than at the next tick.
    /// </summary>
    private static TimeSpan NextAfter(IReadOnlyList<ClaudeLimit> limits)
    {
        var normal = Idle() ? IdlePoll : ActivePoll;
        var now = DateTimeOffset.UtcNow;
        foreach (var limit in limits)
        {
            if (limit.ResetsAt is null) continue;
            if (!DateTimeOffset.TryParse(limit.ResetsAt, out var resets)) continue;
            var until = resets - now + AfterReset;
            if (until > TimeSpan.Zero && until < normal) normal = until;
        }
        return normal;
    }

    private TimeSpan Backoff()
    {
        _backoff = _backoff == TimeSpan.Zero
            ? MinBackoff
            : TimeSpan.FromTicks(Math.Min(_backoff.Ticks * 2, MaxBackoff.Ticks));
        return _backoff;
    }

    /* ------------------------------------------------------------- tokens -- */

    private readonly record struct Credentials(string Access, string Refresh, long ExpiresAt);

    private sealed class RefreshExpiredException : Exception { }

    private static Credentials? ReadCredentials()
    {
        var path = CredentialsPath();
        if (!File.Exists(path)) return null;
        var root = JsonNode.Parse(File.ReadAllText(path))?["claudeAiOauth"];
        var access = root?["accessToken"]?.GetValue<string>();
        var refresh = root?["refreshToken"]?.GetValue<string>();
        if (string.IsNullOrEmpty(access) || string.IsNullOrEmpty(refresh)) return null;
        return new Credentials(access, refresh, root?["expiresAt"]?.GetValue<long>() ?? 0);
    }

    private (string? Plan, string? Tier) PlanOf()
    {
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(CredentialsPath()))?["claudeAiOauth"];
            return (root?["subscriptionType"]?.GetValue<string>(),
                    root?["rateLimitTier"]?.GetValue<string>());
        }
        catch { return (null, null); }
    }

    /// <summary>
    /// An access token good for the next few minutes, refreshing first if not.
    ///
    /// THE ROTATED PAIR IS WRITTEN BACK TO .credentials.json, and that is a
    /// deliberate choice rather than a liberty taken with the CLI's file.
    /// Refresh tokens rotate: the moment one is spent the old one dies. So two
    /// independent holders — this agent keeping a private copy, and the CLI
    /// keeping the file — would invalidate each other within a day, and whichever
    /// refreshed second would be the one that broke. One canonical file is the
    /// only arrangement in which both keep working. The write preserves every
    /// field it did not set, and is atomic, so a crash mid-write cannot leave
    /// you logged out.
    /// </summary>
    private async Task<string> EnsureFreshAsync(Credentials creds, CancellationToken cancel)
    {
        var expires = DateTimeOffset.FromUnixTimeMilliseconds(creds.ExpiresAt);
        if (creds.ExpiresAt > 0 && expires - DateTimeOffset.UtcNow > RefreshMargin) return creds.Access;

        using var request = new HttpRequestMessage(HttpMethod.Post, TokenUrl)
        {
            Content = JsonContent.Create(new
            {
                grant_type = "refresh_token",
                refresh_token = creds.Refresh,
                client_id = ClientId,
            }),
        };
        using var response = await _http.SendAsync(request, cancel);

        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden
            or HttpStatusCode.BadRequest)
            throw new RefreshExpiredException();
        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonNode>(cancellationToken: cancel);
        var access = body?["access_token"]?.GetValue<string>();
        if (string.IsNullOrEmpty(access)) throw new InvalidOperationException("no access_token in refresh");

        WriteBack(
            access,
            body?["refresh_token"]?.GetValue<string>() ?? creds.Refresh,
            body?["expires_in"]?.GetValue<long>());
        return access;
    }

    /// <summary>
    /// Temp file then File.Move(overwrite), the same shape as lib/atomic.ts on
    /// the board side: the CLI must never observe a half-written credentials
    /// file, because the failure mode is you being silently logged out.
    /// </summary>
    private static void WriteBack(string access, string refresh, long? expiresIn)
    {
        var path = CredentialsPath();
        var root = JsonNode.Parse(File.ReadAllText(path)) as JsonObject
            ?? throw new InvalidOperationException("credentials file is not an object");
        if (root["claudeAiOauth"] is not JsonObject oauth)
            throw new InvalidOperationException("credentials file has no claudeAiOauth");

        oauth["accessToken"] = access;
        oauth["refreshToken"] = refresh;
        if (expiresIn is > 0)
            oauth["expiresAt"] = DateTimeOffset.UtcNow.AddSeconds(expiresIn.Value).ToUnixTimeMilliseconds();

        var temp = path + ".dayboard.tmp";
        File.WriteAllText(temp, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temp, path, overwrite: true);
    }

    /* -------------------------------------------------------------- state -- */

    private void Set(ClaudeSnapshot snapshot)
    {
        lock (_gate) _snapshot = snapshot;
    }

    /// <summary>
    /// Record a failure WITHOUT throwing away the last good numbers. A 429 or a
    /// dropped wifi does not make yesterday's 91% untrue, and a board that blanks
    /// its bars every time a request fails is less useful than one that keeps
    /// showing them with the age attached — which is exactly what `stale()` does
    /// for the server-side widgets in lib/memo.ts.
    /// </summary>
    private void Keep(string state, string note)
    {
        lock (_gate) _snapshot = _snapshot with { State = state, Note = note };
    }

    /* --------------------------------------------------------------- idle -- */

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInput
    {
        public uint Size;
        public uint Ticks;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LastInput info);

    /// <summary>Has nobody touched the keyboard or mouse in IdleAfter.</summary>
    private static bool Idle()
    {
        try
        {
            var info = new LastInput { Size = (uint)Marshal.SizeOf<LastInput>() };
            if (!GetLastInputInfo(ref info)) return false;
            return TimeSpan.FromMilliseconds(unchecked((uint)Environment.TickCount - info.Ticks)) > IdleAfter;
        }
        catch { return false; }
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _loop?.Wait(TimeSpan.FromSeconds(2)); } catch { /* shutting down */ }
        _stop.Dispose();
        _http.Dispose();
    }
}
