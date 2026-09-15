using System.Globalization;
using System.Net.NetworkInformation;
using System.Security.Principal;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

namespace Dayboard.NowPlaying;

/*
 * The second thing this agent knows that a remote server cannot: how the machine
 * itself is doing.
 *
 * It is here rather than in a process of its own because the socket, the CORS
 * allowlist, the autostart task and the browser-side base URL all already exist
 * and all already point at 127.0.0.1:7343. A second agent would double every one
 * of those to serve one more JSON document.
 *
 * Its own file, though, because Program.cs is the media session and the server,
 * and none of the below has anything to do with either.
 */

internal sealed record CpuVitals(string? Name, float? LoadPct, float? TempC, float? PowerW, float? ClockMhz);
internal sealed record GpuVitals(
    string? Name, float? LoadPct, float? TempC, float? PowerW,
    float? MemUsedMb, float? MemTotalMb, float? FanRpm);
internal sealed record RamVitals(float? UsedGb, float? TotalGb, float? LoadPct);
internal sealed record FanReading(string Name, float Rpm);
internal sealed record DriveReading(string Name, float? TempC, float? UsedPct);
internal sealed record DiskReading(string Name, double FreeGb, double TotalGb);
internal sealed record NetVitals(string? Name, float? RxBps, float? TxBps);

/// <summary>What the browser is told about the hardware.</summary>
internal sealed record VitalsSnapshot(
    bool Ok,
    bool Elevated,
    CpuVitals? Cpu,
    GpuVitals? Gpu,
    RamVitals? Ram,
    NetVitals? Net,
    IReadOnlyList<FanReading> Fans,
    IReadOnlyList<DriveReading> Drives,
    IReadOnlyList<DiskReading> Disks,
    long UptimeSec,
    string UpdatedAt,
    // Last, and null here rather than sampled: Vitals owns hardware sensors on a
    // 1-second tick and knows nothing about the process table, which is read from
    // the OS on its own slower one. The server composes the two so the Computer
    // tab gets one poll instead of two — see HttpServer's /vitals case. An agent
    // built before this exists simply omits the field, the way `net` was added.
    //
    // The mixer used to ride along here on the same argument; it moved to the
    // player bar, which reads /audio directly.
    IReadOnlyList<ProcessGroup>? Processes = null)
{
    public static VitalsSnapshot Empty(bool elevated) => new(
        false, elevated, null, null, null, null, [], [], [], 0,
        DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
}

/// <summary>
/// Temperatures, load, fans and free space, sampled once a second.
///
/// Shaped on LevelMeter: its own cadence, a lock-guarded snapshot, Read() hands
/// back a copy, and a failure sets Available = false and takes nothing else down
/// with it. What is playing must never depend on whether a sensor answered.
///
/// TEMPERATURES NEED ELEVATION AND MOST OTHER THINGS DO NOT. LibreHardwareMonitor
/// reads CPU package temperature over MSRs and case fans over SuperIO ports,
/// which means a kernel driver, which means Administrator. GPU figures come from
/// NVML and memory from the OS, so those arrive either way. So this never gates
/// on `Elevated`: it opens whatever it can, reports which it got, and lets the
/// widget explain the gaps. Every field on the wire is nullable for that reason.
///
/// That is also why the autostart task runs at -RunLevel Highest instead of the
/// exe carrying a requireAdministrator manifest — a manifest would put a UAC
/// prompt in front of every manual launch, `dotnet run` included, and could not
/// be started by the existing task at all.
/// </summary>
internal sealed class Vitals : IDisposable
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly object _gate = new();
    private readonly UpdateVisitor _visitor = new();
    private readonly NetMeter _net = new();
    private Computer? _computer;
    private Timer? _poll;
    private VitalsSnapshot _snapshot;

    /// <summary>Did the library open at all. False means the endpoint is empty.</summary>
    public bool Available { get; private set; }

    /// <summary>Running as Administrator, and therefore able to see temperatures.</summary>
    public bool Elevated { get; }

    public Vitals()
    {
        Elevated = IsElevated();
        _snapshot = VitalsSnapshot.Empty(Elevated);
    }

    private static bool IsElevated()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    public void Start()
    {
        try
        {
            _computer = Open();
            Available = true;
            Sample(null);
            _poll = new Timer(Sample, null, 1000, 1000);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"vitals: {ex.Message} (no hardware readings; the rest of the agent is unaffected)");
            Available = false;
        }
    }

    private static Computer Open()
    {
        var computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            // Case fans and board temperatures hang off the SuperIO chip, which is
            // SUB-hardware of the motherboard — hence the visitor at the bottom.
            IsMotherboardEnabled = true,
            IsStorageEnabled = true,
            // Network is read straight from the OS instead — see NetMeter.
            IsNetworkEnabled = false,
            IsControllerEnabled = false,
            IsBatteryEnabled = false,
            IsPsuEnabled = false,
        };
        computer.Open();
        return computer;
    }

    /// <summary>The latest reading. The record is immutable, so this is a safe handout.</summary>
    public VitalsSnapshot Read()
    {
        lock (_gate) return _snapshot;
    }

    public static string ToJson(VitalsSnapshot snapshot) => JsonSerializer.Serialize(snapshot, Json);

    private void Sample(object? _)
    {
        if (_computer is null) return;
        try
        {
            _computer.Accept(_visitor);
            var all = Flatten(_computer.Hardware).ToList();

            var cpu = all.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
            var gpu = all.FirstOrDefault(h =>
                h.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel);
            var ram = all.FirstOrDefault(h => h.HardwareType == HardwareType.Memory);

            var usedGb = Named(ram, SensorType.Data, "Memory Used");
            var freeGb = Named(ram, SensorType.Data, "Memory Available");

            var next = new VitalsSnapshot(
                Ok: true,
                Elevated: Elevated,
                Cpu: cpu is null ? null : new CpuVitals(
                    cpu.Name,
                    Named(cpu, SensorType.Load, "CPU Total"),
                    // Vendors disagree on the name, so try the known ones and then
                    // fall back to the hottest core — which is what a single "CPU
                    // temperature" means anyway.
                    Named(cpu, SensorType.Temperature, "Core (Tctl/Tdie)", "CPU Package", "Core Average")
                        ?? Across(cpu, SensorType.Temperature, "Core #", "CPU Core #"),
                    Named(cpu, SensorType.Power, "Package", "CPU Package"),
                    Across(cpu, SensorType.Clock, "Core #", "CPU Core #")),
                Gpu: gpu is null ? null : new GpuVitals(
                    gpu.Name,
                    Named(gpu, SensorType.Load, "GPU Core"),
                    Named(gpu, SensorType.Temperature, "GPU Core", "GPU Hot Spot"),
                    Named(gpu, SensorType.Power, "GPU Package", "GPU Power"),
                    Named(gpu, SensorType.SmallData, "GPU Memory Used", "D3D Dedicated Memory Used"),
                    Named(gpu, SensorType.SmallData, "GPU Memory Total"),
                    Named(gpu, SensorType.Fan, "GPU Fan", "GPU Fan 1")),
                Ram: ram is null ? null : new RamVitals(
                    usedGb,
                    // LibreHardwareMonitor reports no total, only used and available.
                    usedGb is null || freeGb is null ? null : usedGb + freeGb,
                    Named(ram, SensorType.Load, "Memory")),
                Net: _net.Read(),
                Fans: all
                    .Where(h => h.HardwareType is HardwareType.Motherboard or HardwareType.SuperIO
                        or HardwareType.Cooler)
                    .SelectMany(h => h.Sensors)
                    // A header with nothing plugged into it reads 0 and is noise.
                    .Where(s => s.SensorType == SensorType.Fan
                        && s.Value is { } rpm && float.IsFinite(rpm) && rpm > 0)
                    .Select(s => new FanReading(s.Name, s.Value!.Value))
                    .ToList(),
                Drives: all
                    .Where(h => h.HardwareType == HardwareType.Storage)
                    .Select(h => new DriveReading(
                        h.Name,
                        Usable(h.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Temperature)?.Value,
                            SensorType.Temperature),
                        Usable(h.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Load && s.Name == "Used Space")?.Value,
                            SensorType.Load)))
                    .Where(d => d.TempC is not null || d.UsedPct is not null)
                    .ToList(),
                // Free space is an OS question rather than a sensor one, and needs
                // no driver — so it arrives even unelevated, unlike drive temps.
                Disks: ReadDisks(),
                UptimeSec: Environment.TickCount64 / 1000,
                UpdatedAt: DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));

            lock (_gate) _snapshot = next;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"vitals: sample failed — {ex.Message}");
        }
    }

    private static List<DiskReading> ReadDisks()
    {
        var disks = new List<DiskReading>();
        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (drive.DriveType != DriveType.Fixed || !drive.IsReady) continue;
                disks.Add(new DiskReading(
                    drive.Name.TrimEnd('\\'),
                    drive.AvailableFreeSpace / 1073741824d,
                    drive.TotalSize / 1073741824d));
            }
            catch
            {
                // A drive that went away between the enumeration and the question.
            }
        }
        return disks;
    }

    private static IEnumerable<IHardware> Flatten(IEnumerable<IHardware> hardware)
    {
        foreach (var item in hardware)
        {
            yield return item;
            foreach (var sub in Flatten(item.SubHardware)) yield return sub;
        }
    }

    /// <summary>
    /// A reading we are willing to put on the wire.
    ///
    /// TWO TRAPS, BOTH FOUND BY RUNNING --dump-sensors UNELEVATED ON THIS MACHINE
    /// rather than by reading the API docs:
    ///
    /// NaN. Without the driver the per-core Clock sensors report float.NaN, not
    /// null. NaN is not valid JSON, so a single unelevated clock reading would
    /// have taken the whole endpoint down rather than leaving one field blank.
    ///
    /// Zero. "Core (Tctl/Tdie)" and CPU "Package" power both exist unelevated and
    /// both read exactly 0 — a sensor saying "I am here but I cannot see", which
    /// would render as a 0°C CPU. So for temperature and power, zero is absent.
    /// Not for load or memory, where zero is a real and useful answer.
    /// </summary>
    private static float? Usable(float? value, SensorType type)
    {
        if (value is not { } v || !float.IsFinite(v)) return null;
        if (v == 0 && type is SensorType.Temperature or SensorType.Power) return null;
        return v;
    }

    /// <summary>The first of these sensor names that has a usable value.</summary>
    private static float? Named(IHardware? hardware, SensorType type, params string[] names)
    {
        if (hardware is null) return null;
        foreach (var name in names)
        {
            var hit = hardware.Sensors.FirstOrDefault(s => s.SensorType == type && s.Name == name);
            if (Usable(hit?.Value, type) is { } value) return value;
        }
        return null;
    }

    /// <summary>The highest usable reading across every per-core sensor of a type.</summary>
    private static float? Across(IHardware? hardware, SensorType type, params string[] prefixes)
    {
        if (hardware is null) return null;
        var values = hardware.Sensors
            .Where(s => s.SensorType == type
                && prefixes.Any(p => s.Name.StartsWith(p, StringComparison.Ordinal)))
            .Select(s => Usable(s.Value, type))
            .Where(v => v is not null)
            .Select(v => v!.Value)
            .ToList();
        return values.Count == 0 ? null : values.Max();
    }

    /// <summary>
    /// Every sensor this machine exposes, printed once.
    ///
    /// Sensor names are motherboard- and vendor-specific, so the table in Sample()
    /// above is pinned to what this prints rather than guessed — the same standard
    /// lib/subway.ts holds itself to. Run it elevated or the interesting half is
    /// missing: `dayboard-nowplaying --dump-sensors`.
    /// </summary>
    public static void Dump()
    {
        Console.WriteLine($"elevated: {IsElevated()}"
            + (IsElevated() ? "" : "   <- CPU temperatures and case fans will be missing"));
        // Computer is not IDisposable — Close() is the whole teardown.
        var computer = Open();
        computer.Accept(new UpdateVisitor());
        foreach (var hardware in Flatten(computer.Hardware))
        {
            Console.WriteLine($"\n{hardware.HardwareType}  {hardware.Name}");
            foreach (var sensor in hardware.Sensors.OrderBy(s => s.SensorType).ThenBy(s => s.Name))
            {
                var value = sensor.Value?.ToString("0.##", CultureInfo.InvariantCulture) ?? "null";
                Console.WriteLine($"    {sensor.SensorType,-12} {sensor.Name,-30} {value}");
            }
        }
        computer.Close();
    }

    public void Dispose()
    {
        _poll?.Dispose();
        try
        {
            _computer?.Close();
        }
        catch
        {
            // Closing a library that never opened is not news.
        }
    }
}

/// <summary>
/// Network throughput, computed here rather than taken from the sensor library.
///
/// LibreHardwareMonitor does expose Download/Upload Speed, and on this machine
/// they are not trustworthy: measured against Windows own adapter counters over
/// the same ten-second window, it reported a 232 KB/s second inside a window in
/// which the adapter received 37 KB in total. A rate derived from a delta over
/// an elapsed the caller does not control will do that — one late Update and the
/// divisor is wrong.
///
/// So this keeps its own last-reading and its own clock, which makes the rate
/// arithmetic something we can reason about and guard: an implausibly small
/// elapsed is skipped rather than dividing by it, and a counter that went
/// backwards (an adapter reset, a sleep/resume) reports zero rather than a
/// negative or an enormous number.
///
/// It also needs no kernel driver, so the network rail is one of the parts that
/// survives an unelevated run.
/// </summary>
internal sealed class NetMeter
{
    /// <summary>Below this, the divisor is doing more harm than the sample is worth.</summary>
    private const double MinElapsedSec = 0.25;

    private string? _id;
    private long _rx;
    private long _tx;
    private long _at;
    private NetVitals? _last;

    /// <summary>
    /// The adapter worth showing: up, real, and carrying the most traffic in
    /// total.
    ///
    /// CUMULATIVE traffic, not current — a Windows box has half a dozen
    /// adapters and picking whichever is busiest *this second* lets a virtual
    /// one win a quiet moment and the rail flip between two names. Lifetime
    /// bytes is a stable answer: on a typical desktop it is the wired NIC with
    /// 50 GB against 0 for the disconnected PCIe one.
    /// </summary>
    private static NetworkInterface? Pick()
    {
        NetworkInterface? best = null;
        long bestTotal = -1;
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            try
            {
                var stats = nic.GetIPStatistics();
                var total = stats.BytesReceived + stats.BytesSent;
                if (total <= bestTotal) continue;
                bestTotal = total;
                best = nic;
            }
            catch
            {
                // An adapter that went away mid-enumeration, or one whose stats
                // the driver will not answer for.
            }
        }
        return best;
    }

    public NetVitals? Read()
    {
        try
        {
            var nic = Pick();
            if (nic is null) return _last;

            var stats = nic.GetIPStatistics();
            var now = Environment.TickCount64;

            // A different adapter, or the first reading: record and wait. One
            // sample cannot be a rate.
            if (_id != nic.Id)
            {
                _id = nic.Id;
                _rx = stats.BytesReceived;
                _tx = stats.BytesSent;
                _at = now;
                _last = new NetVitals(nic.Name, 0, 0);
                return _last;
            }

            var elapsed = (now - _at) / 1000d;
            if (elapsed < MinElapsedSec) return _last;

            var rx = Math.Max(0, stats.BytesReceived - _rx) / elapsed;
            var tx = Math.Max(0, stats.BytesSent - _tx) / elapsed;

            _rx = stats.BytesReceived;
            _tx = stats.BytesSent;
            _at = now;
            _last = new NetVitals(nic.Name, (float)rx, (float)tx);
            return _last;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"vitals: network — {ex.Message}");
            return _last;
        }
    }
}

/// <summary>
/// Mandatory, and the one genuinely non-obvious part of this API: Open() alone
/// hands back hardware whose sensors have no values. Every sample has to Accept
/// a visitor that calls Update() AND recurses into SubHardware, or the
/// motherboard's fans and board temperatures never appear at all.
/// </summary>
internal sealed class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) => computer.Traverse(this);

    public void VisitHardware(IHardware hardware)
    {
        hardware.Update();
        foreach (var sub in hardware.SubHardware) sub.Accept(this);
    }

    public void VisitSensor(ISensor sensor) { }

    public void VisitParameter(IParameter parameter) { }
}
