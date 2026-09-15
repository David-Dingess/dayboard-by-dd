using System.Text.Json;
using System.Text.Json.Nodes;

namespace Dayboard.NowPlaying;

/*
 * Whether Claude is working, waiting on you, or doing nothing at all.
 *
 * Separate from Claude.cs, which is about the SUBSCRIPTION — a slow number from
 * somebody else's API. This is about the SESSIONS, a fast fact off the local
 * disk, and the two have nothing in common but a name and a route.
 *
 * WHY FILES AND NOT HOOKS. Claude Code exposes every event this needs —
 * UserPromptSubmit, PreToolUse, PermissionRequest, Stop, SessionEnd are all in
 * the binary — and an earlier draft of this used them. Hooks lose on two counts
 * for a board: they have to be configured into every session, so a session
 * started before the config lands is invisible; and they report transitions
 * rather than state, so a session that CRASHES never fires its Stop and leaves
 * the board insisting Claude is still working. Reading the files is stateless —
 * whatever is on disk right now is the answer — and needs no setup at all.
 *
 * NOTHING HERE READS A MESSAGE. Only file timestamps, the `type` of the last
 * transcript entry, and the block types inside it. That is deliberate and worth
 * keeping: ~/.claude/projects holds transcripts from every project you work
 * on, client work included, and a second-monitor dashboard is the last place
 * any of that should surface.
 */

/// <summary>What the mascot on the shelf is doing.</summary>
internal static class ClaudeActivity
{
    /// <summary>A session is generating or running a tool right now.</summary>
    public const string Working = "working";
    /// <summary>A turn ended, or a permission prompt is up. Your move.</summary>
    public const string Waiting = "waiting";
    /// <summary>Sessions open but long quiet, or none at all.</summary>
    public const string Chilling = "chilling";
}

internal sealed record ClaudeSessionsSnapshot(
    /// <summary>Worst-state-wins across every live session: waiting &gt; working &gt; chilling.</summary>
    string Activity,
    /// <summary>How many Claude Code processes are actually alive.</summary>
    int Live,
    /// <summary>Folder name of the session that set the activity, for the tooltip.</summary>
    string? Where,
    /// <summary>Seconds since that session last wrote. Null when nothing is live.</summary>
    double? QuietFor)
{
    public static readonly ClaudeSessionsSnapshot Idle =
        new(ClaudeActivity.Chilling, 0, null, null);
}

/// <summary>
/// Reads ~/.claude/sessions and the transcripts those sessions are writing.
///
/// Sampled on a timer like Vitals rather than on request, because the widget
/// polls this often enough to animate a sprite and statting a dozen files on
/// every GET would put your disk in the render loop.
/// </summary>
internal sealed class ClaudeSessions : IDisposable
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>
    /// Under this, the transcript is being written to and Claude is mid-turn.
    /// Generous on purpose: a long thinking block or a slow tool can leave
    /// several seconds between writes, and a mascot that flickers between
    /// walking and sitting is worse than one that is a beat late to sit down.
    /// </summary>
    private const double WorkingWithinSeconds = 12;
/// <summary>
    /// A pending prompt older than this stops nagging.
    ///
    /// Generous, because unlike a finished turn a permission prompt genuinely
    /// IS blocked on you for as long as it sits there. The cap exists only so
    /// a session abandoned mid-prompt does not have the cat staring at you
    /// all night.
    /// </summary>
    private const double WaitingUntilSeconds = 2 * 60 * 60;

    private readonly object _gate = new();
    private readonly Timer _poll;
    private ClaudeSessionsSnapshot _snapshot = ClaudeSessionsSnapshot.Idle;

    public ClaudeSessions() => _poll = new Timer(Sample, null, 0, 2000);

    public ClaudeSessionsSnapshot Read()
    {
        lock (_gate) return _snapshot;
    }

    public static string ToJson(ClaudeSessionsSnapshot snapshot) =>
        JsonSerializer.Serialize(snapshot, Json);

    private static string Root()
    {
        var dir = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
        return string.IsNullOrWhiteSpace(dir)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude")
            : dir;
    }

    private void Sample(object? _)
    {
        try
        {
            var result = Look();
            lock (_gate) _snapshot = result;
        }
        catch
        {
            // A half-written session file or a transcript being rotated. Keep the
            // last answer; this runs again in two seconds.
        }
    }

    private static ClaudeSessionsSnapshot Look()
    {
        var sessionsDir = Path.Combine(Root(), "sessions");
        if (!Directory.Exists(sessionsDir)) return ClaudeSessionsSnapshot.Idle;

        var live = 0;
        var best = ClaudeActivity.Chilling;
        string? where = null;
        double? quiet = null;

        foreach (var file in Directory.EnumerateFiles(sessionsDir, "*.json"))
        {
            var session = ReadSession(file);
            if (session is null) continue;
            // The registry is written on start and not always cleaned up on a
            // crash, so the FILE is a claim and the process is the proof.
            if (!Alive(session.Value.Pid)) continue;
            live++;

            var (activity, age) = StateOf(session.Value.SessionId);
            if (Rank(activity) <= Rank(best)) continue;
            best = activity;
            where = Folder(session.Value.Cwd);
            quiet = age;
        }

        if (live == 0) return ClaudeSessionsSnapshot.Idle;
        return new ClaudeSessionsSnapshot(best, live, where, quiet);
    }

    /// <summary>Waiting outranks working: the board's job is to say when you are the blocker.</summary>
    private static int Rank(string activity) => activity switch
    {
        ClaudeActivity.Waiting => 2,
        ClaudeActivity.Working => 1,
        _ => 0,
    };

    private readonly record struct Session(int Pid, string SessionId, string Cwd);

    private static Session? ReadSession(string path)
    {
        try
        {
            var node = JsonNode.Parse(File.ReadAllText(path));
            var pid = node?["pid"]?.GetValue<int>();
            var id = node?["sessionId"]?.GetValue<string>();
            if (pid is null || string.IsNullOrEmpty(id)) return null;
            return new Session(pid.Value, id, node?["cwd"]?.GetValue<string>() ?? "");
        }
        catch { return null; }
    }

    private static bool Alive(int pid)
    {
        try
        {
            using var process = System.Diagnostics.Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch { return false; }
    }

    private static string? Folder(string cwd) =>
        string.IsNullOrEmpty(cwd) ? null : new DirectoryInfo(cwd).Name;

/// <summary>
    /// What one session is doing, from its transcript.
    ///
    /// WAITING MEANS BLOCKED, NOT FINISHED. An earlier version counted any
    /// recently-ended turn as "waiting on you", and it is true that this is
    /// simply false — a conversation you consider over is not one you owe
    /// anything to, and treating it as one made the shelf nag about five
    /// finished Dayboard sessions at once.
    ///
    /// So the only thing that counts is a session that CANNOT PROCEED: Claude
    /// asked to run a tool and the answer never came. That leaves a trailing
    /// `assistant` entry carrying a `tool_use` block with no `tool_result`
    /// after it. A finished turn ends in an `assistant` entry of plain text
    /// instead, which is the difference the board hangs on.
    ///
    /// Actively running an approved tool leaves the SAME trailing shape, so
    /// mtime is what separates the two: still being written means the tool is
    /// running, gone quiet means nobody ever answered the prompt.
    /// </summary>
    private static (string Activity, double? Age) StateOf(string sessionId)
    {
        var transcript = FindTranscript(sessionId);
        if (transcript is null) return (ClaudeActivity.Chilling, null);

        var age = (DateTime.UtcNow - File.GetLastWriteTimeUtc(transcript)).TotalSeconds;
        if (age < WorkingWithinSeconds) return (ClaudeActivity.Working, age);
        if (age > WaitingUntilSeconds) return (ClaudeActivity.Chilling, age);

        return LastEntryIsPendingTool(transcript)
            ? (ClaudeActivity.Waiting, age)
            : (ClaudeActivity.Chilling, age);
    }

    /// <summary>
    /// The transcript is named for the session id, but which project folder it
    /// lands in is Claude Code's business — so search rather than derive the
    /// path from cwd and hope the encoding matches.
    /// </summary>
    private static string? FindTranscript(string sessionId)
    {
        var projects = Path.Combine(Root(), "projects");
        if (!Directory.Exists(projects)) return null;
        try
        {
            return Directory
                .EnumerateFiles(projects, sessionId + ".jsonl", SearchOption.AllDirectories)
                .FirstOrDefault();
        }
        catch { return null; }
    }

/// <summary>
    /// Does the transcript end on an unanswered tool request.
    ///
    /// Reads the TAIL only. These files reach hundreds of kilobytes over a long
    /// session and this runs every two seconds, so reading one whole would be
    /// the most expensive thing the agent does, by a wide margin.
    /// </summary>
    private static bool LastEntryIsPendingTool(string path)
    {
        try
        {
            using var stream = new FileStream(
                path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            const int Window = 16 * 1024;
            var take = (int)Math.Min(Window, stream.Length);
            stream.Seek(-take, SeekOrigin.End);
            var buffer = new byte[take];
            stream.ReadExactly(buffer, 0, take);

            var lines = System.Text.Encoding.UTF8.GetString(buffer)
                .Split('\n', StringSplitOptions.RemoveEmptyEntries);
            // Backwards, because the last line can be a partial write and the
            // first line is almost certainly one (the window starts mid-file).
            for (var i = lines.Length - 1; i >= 0; i--)
            {
                JsonNode? node;
                try { node = JsonNode.Parse(lines[i]); }
                catch { continue; }
                var type = node?["type"]?.GetValue<string>();
                if (type is null) continue;
                // The first complete entry from the end decides it. Anything but
                // an assistant turn — a tool_result, a user message — means the
                // request was answered.
                if (type != "assistant") return false;
                return HasToolUse(node);
            }
            return false;
        }
        catch { return false; }
    }

    /// <summary>
    /// Block TYPES only, never their contents — see this file's header. A
    /// message's content is a list of blocks, or a bare string for plain text.
    /// </summary>
    private static bool HasToolUse(JsonNode? entry)
    {
        if (entry?["message"]?["content"] is not JsonArray blocks) return false;
        foreach (var block in blocks)
            if (block?["type"]?.GetValue<string>() == "tool_use") return true;
        return false;
    }

    public void Dispose() => _poll.Dispose();
}
