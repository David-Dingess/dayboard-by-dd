using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;

namespace Dayboard.NowPlaying;

/// <summary>What the browser is told about who is using the machine.</summary>
internal sealed record ProcessGroup(string Name, double Cpu, double MemMb, int Count);

/// <summary>
/// The top few processes by CPU, so the PC tab can say WHO rather than only how
/// much. It answers the question the load bar provokes and cannot itself answer.
///
/// NOT PART OF Vitals, and not on its timer. That class is LibreHardwareMonitor
/// sensors on a 1-second tick; this is the OS process table on a 2-second one,
/// which is the widget's own poll interval and half the work. The precedent is
/// NetMeter: a reading the sensor library does not have, taken straight from the
/// OS, kept beside the others rather than folded into them. The server composes
/// the two into one payload — see HttpServer's /vitals case.
///
/// GROUPED BY NAME, NOT LISTED BY PID. Chrome is thirty processes and Ableton
/// spawns plugin hosts; five chrome.exe rows would be true and useless. Summing
/// per name is the reading a person actually wants, and the instance count is
/// kept so a swarm still looks like one.
///
/// CPU% NEEDS TWO SAMPLES. There is no instantaneous figure to read — only total
/// processor time, which has to be differenced against the board clock and divided
/// by the core count. So the first pass after startup reports nothing, which is
/// the same thing an agent built before this feature reports, and the widget's
/// one empty branch covers both.
/// </summary>
internal sealed class Processes : IDisposable
{
    /// <summary>The widget polls at 2s; sampling faster would only average noise.</summary>
    private const int IntervalMs = 2000;

    /// <summary>Five rows is what fits under the fans without scrolling.</summary>
    private const int Top = 5;

    private readonly object _gate = new();
    private readonly Timer _poll;

    /// <summary>pid → the last CPU total and when it was read. The baseline.</summary>
    private Dictionary<int, (TimeSpan Cpu, DateTime At)> _last = new();
    private IReadOnlyList<ProcessGroup>? _snapshot;

    public Processes()
    {
        _poll = new Timer(_ => Sample(), null, Timeout.Infinite, Timeout.Infinite);
    }

    public void Start() => _poll.Change(0, IntervalMs);

    /// <summary>Null until a second sample exists to difference against.</summary>
    public IReadOnlyList<ProcessGroup>? Read()
    {
        lock (_gate) { return _snapshot; }
    }

    private void Sample()
    {
        try
        {
            var (groups, seen) = Collect(_last);
            lock (_gate)
            {
                // Only overwrite once there is something to say: the first pass
                // has no baseline, and replacing a good list with null would make
                // the section blink out for two seconds on every hiccup.
                if (groups is not null) _snapshot = groups;
            }
            // Replaced wholesale rather than pruned key by key, which is the
            // cheapest way to drop the pids that have exited since last time.
            _last = seen;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"processes: {ex.Message} (the rest of the agent is unaffected)");
        }
    }

    /// <summary>
    /// One pass over the process table, differenced against the previous one.
    /// Static and pure-ish so --dump-processes can drive it without a timer.
    /// </summary>
    private static (IReadOnlyList<ProcessGroup>? Groups, Dictionary<int, (TimeSpan Cpu, DateTime At)> Seen)
        Collect(Dictionary<int, (TimeSpan Cpu, DateTime At)> previous)
    {
        var seen = new Dictionary<int, (TimeSpan Cpu, DateTime At)>();
        var totals = new Dictionary<string, (double Cpu, double MemMb, int Count)>(StringComparer.OrdinalIgnoreCase);
        var cores = Math.Max(1, Environment.ProcessorCount);
        var now = DateTime.UtcNow;
        var anyBaseline = false;

        foreach (var process in Process.GetProcesses())
        {
            try
            {
                // The Idle process is the CPU doing nothing, reported as a
                // process that uses all of it. Left in, it is permanently first
                // with ~90% and the section says nothing at all.
                if (process.Id == 0) continue;
                var name = process.ProcessName;
                if (name.Equals("Idle", StringComparison.OrdinalIgnoreCase)) continue;

                var cpuTime = process.TotalProcessorTime;
                var memMb = process.WorkingSet64 / (1024d * 1024d);
                seen[process.Id] = (cpuTime, now);

                var cpu = 0d;
                if (previous.TryGetValue(process.Id, out var before))
                {
                    var elapsed = (now - before.At).TotalMilliseconds;
                    if (elapsed > 0)
                    {
                        anyBaseline = true;
                        cpu = (cpuTime - before.Cpu).TotalMilliseconds / (elapsed * cores) * 100d;
                        // A pid reused by a shorter-lived process reads as a
                        // negative delta. Clamped rather than dropped: the memory
                        // figure beside it is still good.
                        if (cpu < 0) cpu = 0;
                    }
                }

                totals.TryGetValue(name, out var running);
                totals[name] = (running.Cpu + cpu, running.MemMb + memMb, running.Count + 1);
            }
            catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or NotSupportedException)
            {
                // Exited between the listing and the read, or belongs to another
                // user and this agent is not elevated. Both are ordinary; the
                // elevation note already under the fans explains a thin list.
            }
            finally
            {
                process.Dispose();
            }
        }

        if (!anyBaseline) return (null, seen);

        var groups = totals
            .Select(entry => new ProcessGroup(entry.Key, entry.Value.Cpu, entry.Value.MemMb, entry.Value.Count))
            .OrderByDescending(group => group.Cpu)
            .ThenByDescending(group => group.MemMb)
            .Take(Top)
            .ToList();

        return (groups, seen);
    }

    /// <summary>
    /// --dump-processes: two passes a second apart and the grouped result, which
    /// is the only way to see whether a CPU figure is believable. The house
    /// convention, after Vitals.Dump and Voicemeeter.Dump.
    /// </summary>
    public static async Task DumpAsync()
    {
        Console.WriteLine($"cores: {Environment.ProcessorCount}");
        var (_, first) = Collect(new Dictionary<int, (TimeSpan, DateTime)>());
        Console.WriteLine($"pass 1: {first.Count} processes, no baseline yet");
        await Task.Delay(IntervalMs);

        var (groups, second) = Collect(first);
        Console.WriteLine($"pass 2: {second.Count} processes");
        if (groups is null)
        {
            Console.WriteLine("  (nothing to report — no process survived both passes)");
            return;
        }
        foreach (var group in groups)
        {
            var count = group.Count > 1 ? $" x{group.Count}" : "";
            Console.WriteLine(
                $"  {group.Cpu.ToString("F1", CultureInfo.InvariantCulture),6}%  "
                + $"{(group.MemMb / 1024d).ToString("F1", CultureInfo.InvariantCulture),6} GB  "
                + $"{group.Name}{count}");
        }
    }

    public void Dispose() => _poll.Dispose();
}
