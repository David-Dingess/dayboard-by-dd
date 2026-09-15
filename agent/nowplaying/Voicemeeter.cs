using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Dayboard.NowPlaying;

/*
 * The third local fact: which speakers the sound is coming out of.
 *
 * THERE WAS A MICROPHONE MUTE HERE. It set Voicemeeter's Strip[0].Mute, which
 * only silences an app listening to that strip, and the Windows default capture
 * device on this machine is a Steam virtual microphone — so it reported a muted
 * mic that nobody was muted on. Muting the Windows endpoints instead did work,
 * and still was not what was wanted: the Stream Deck toggles DISCORD's own
 * mute, which is a third mechanism again. Three places a mute could live and no
 * single answer, so it is gone rather than approximate.
 *
 * On a Voicemeeter machine audio does not go from an app to a device. It goes through Voicemeeter
 * Banana, which mixes its strips — the mic, Discord, a spare cable, the browser
 * and the music player — onto physical buses. So "switch to headphones" is not a Windows
 * default-device change; the Windows default IS Voicemeeter, permanently, and
 * the real question is which of Voicemeeter's own buses is carrying the mix.
 *
 * WHY MUTES AND NOT A DEVICE SWAP. The obvious implementation is to rewrite
 * Bus[0]'s output device between the interface and the onboard codec. That
 * reopens a driver: a click, about a second of silence, and an occasional
 * failure to come back. Instead both buses stay permanently assigned — one the
 * headphones, one the speakers — every app strip is routed to both,
 * and the toggle just mutes one and unmutes the other. It is instant, silent,
 * cannot half-fail, and is visible and reversible in Voicemeeter's own window,
 * which matters because that window is the other writer here.
 *
 * WHY IsParametersDirty BEFORE EVERY READ. The Remote API hands out a cached
 * parameter set and only refreshes it when you ask whether it is dirty. Skip the
 * call and Read() returns whatever was true when the agent started, forever —
 * which looks exactly like a working widget that never notices a change.
 *
 * The DLL is not on the search path and its folder has a space in it, so it is
 * resolved by full path from the installer's own registry key. Everything here
 * fails soft: no Voicemeeter, no DLL, or Voicemeeter not running, and the audio
 * section is simply absent from /vitals and the widget does not render it.
 */

/// <summary>One physical bus: what it feeds, and whether it is muted.</summary>
internal sealed record AudioOutput(string? Device, bool Muted);

/// <summary>What the browser is told about the mixer.</summary>
internal sealed record AudioSnapshot(
    bool Ok,
    bool Running,
    AudioOutput? Headphones,
    AudioOutput? Speakers,
    string Live)
{
    /// <summary>Voicemeeter is installed but not answering — the widget says so.</summary>
    public static AudioSnapshot Down() => new(false, false, null, null, "none");
}

internal sealed class Voicemeeter : IDisposable
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
    };

    public static string ToJson(AudioSnapshot snapshot) =>
        System.Text.Json.JsonSerializer.Serialize(snapshot, Json);

    /// <summary>How many physical buses to consider. Banana has three (A1–A3).</summary>
    private const int PhysicalBuses = 3;

    // WHICH BUS IS WHICH IS READ, NOT ASSUMED. The obvious thing is to declare
    // A1 the headphones and A2 the speakers and be done. But the first --audio-dump
    // against one machine found A1 = the onboard speakers and A2 unassigned,
    // which would have put the room's sound behind a button labelled "Headphones"
    // — the one failure a toggle like this must not have. So the role comes from
    // the device name: an audio interface is usually what the headphones are
    // plugged into, and the onboard codec is usually the speakers. Either bus
    // can hold either, in any order, and the buses can be rearranged in
    // Voicemeeter without this needing to know.
    //
    // The defaults cover the common interfaces and codecs; --headphones and
    // --speakers (Settings -> Computer on the board) replace them with the
    // fragments that match this machine's device names.
    private static string[] HeadphoneNames =
        ["focusrite", "scarlett", "analogue", "headphone", "audient", "motu", "apollo", "volt", "komplete", "steinberg", "dt "];
    private static string[] SpeakerNames = ["realtek", "speakers", "high definition", "monitor", "nvidia", "hdmi", "conexant"];

    /// <summary>Replace the device-name fragments from the command line. Empty leaves the defaults.</summary>
    public static void Configure(string? headphones = null, string? speakers = null)
    {
        static string[] Split(string value) =>
            value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(v => v.ToLowerInvariant()).ToArray();
        if (!string.IsNullOrWhiteSpace(headphones)) HeadphoneNames = Split(headphones);
        if (!string.IsNullOrWhiteSpace(speakers)) SpeakerNames = Split(speakers);
    }

    private const string InstallKey =
        @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}";
    private const string FallbackDir = @"C:\Program Files (x86)\VB\Voicemeeter";
    private const string Dll = "VoicemeeterRemote64.dll";

    private static readonly TimeSpan ReloginAfter = TimeSpan.FromSeconds(5);

    // The Remote API is a single global client per process with no documented
    // thread safety, and /vitals is polled on one connection while a POST to
    // /audio arrives on another. One lock over every call into it.
    private readonly object _gate = new();
    private bool _loggedIn;
    private DateTime _lastLoginAttempt = DateTime.MinValue;
    /// <summary>Which bus was live when the room was muted — see SetMute.</summary>
    private string _liveBeforeMute = "headphones";

    /// <summary>DLL resolved and a login accepted. False means no audio section at all.</summary>
    public bool Available { get; }

    public Voicemeeter()
    {
        try
        {
            var code = Native.Login();
            // 0 = connected. 1 = connected, but the Voicemeeter window is not
            // running yet — which is normal at logon, since this agent and
            // Voicemeeter start at the same moment. Both count as available;
            // Read() re-checks whether the server is actually answering.
            if (code >= 0)
            {
                _loggedIn = true;
                Available = true;
                _lastLoginAttempt = DateTime.UtcNow;
            }
            else
            {
                Console.Error.WriteLine($"voicemeeter: login returned {code} (no audio controls)");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"voicemeeter: {ex.Message} (no audio controls; the rest of the agent is unaffected)");
        }
    }

    /// <summary>The current state of both buses and the microphone.</summary>
    public AudioSnapshot Read()
    {
        if (!Available) return AudioSnapshot.Down();
        lock (_gate)
        {
            return ReadLocked();
        }
    }

    /// <summary>
    /// Make one bus live and mute the other. Returns the state afterwards, so the
    /// POST response is the new truth and the browser needs no second request.
    /// </summary>
    /// <remarks>
    /// "toggle" IS RESOLVED HERE, NOT IN THE BROWSER, and that is the fix for a
    /// switch that worked but felt unreliable. The widget reads /audio on mount
    /// and on visibility and never polls, so after you move a bus in
    /// Voicemeeter's own window its icon is stale — and an absolute target
    /// computed from a stale icon sends the sound the wrong way, once, before
    /// correcting itself. Asking the agent to flip whatever is live right now
    /// cannot be wrong, because it reads the answer a millisecond before acting.
    /// </remarks>
    public AudioSnapshot SetOutput(string which)
    {
        if (!Available) return AudioSnapshot.Down();
        lock (_gate)
        {
            if (!Connected()) return AudioSnapshot.Down();

            if (which == "toggle")
            {
                // Anything that is not cleanly on the headphones goes to them —
                // "both" and "none" are reachable states and headphones is the
                // sane recovery from either.
                which = ReadLocked().Live == "headphones" ? "speakers" : "headphones";
            }

            var headphones = which == "headphones";
            var (hp, sp) = ResolveBuses();

            // Refuse to unmute a bus with nothing plugged into it: that is not a
            // switch, it is silence with a lit button. This is the state the
            // machine is in until A2 is assigned — see docs/agents.md.
            var wanted = headphones ? hp : sp;
            var other = headphones ? sp : hp;
            if (wanted < 0) return ReadLocked() with { Ok = false };

            // One script, applied by Voicemeeter in one pass, so there is no
            // instant where both buses are muted and the room goes quiet.
            var script = $"Bus[{wanted}].Mute=0;";
            if (other >= 0) script += $"Bus[{other}].Mute=1;";
            Native.SetParameters(script);
            return ReadLocked(force: true);
        }
    }

    /// <summary>
    /// Silence both buses, or put the room back the way it was.
    /// </summary>
    /// <remarks>
    /// SetOutput cannot express this: it makes one bus live BY muting the other,
    /// so there is no argument that means "neither". Hence a route of its own —
    /// and the remembered role, because unmuting has to answer "back to what?".
    /// Without it, coming off mute would always land on headphones and quietly
    /// move the sound out of the room.
    ///
    /// The memory is per-process and deliberately not persisted: an agent that
    /// restarted while muted comes back with both buses as Voicemeeter left
    /// them, and guessing at a role from before a reboot is worse than the
    /// default. `live` reads as "none" throughout, which the widget already
    /// understands.
    /// </remarks>
    public AudioSnapshot SetMute(bool mute)
    {
        if (!Available) return AudioSnapshot.Down();
        lock (_gate)
        {
            if (!Connected()) return AudioSnapshot.Down();
            var (hp, sp) = ResolveBuses();

            if (mute)
            {
                var live = ReadLocked().Live;
                if (live is "headphones" or "speakers") _liveBeforeMute = live;
                var script = "";
                if (hp >= 0) script += $"Bus[{hp}].Mute=1;";
                if (sp >= 0) script += $"Bus[{sp}].Mute=1;";
                if (script.Length > 0) Native.SetParameters(script);
                return ReadLocked(force: true);
            }

            // One script, one pass, same as SetOutput: no instant where both are
            // unmuted and the sound is briefly in two rooms.
            var wanted = _liveBeforeMute == "speakers" ? sp : hp;
            var other = _liveBeforeMute == "speakers" ? hp : sp;
            if (wanted < 0) return ReadLocked() with { Ok = false };
            var back = $"Bus[{wanted}].Mute=0;";
            if (other >= 0) back += $"Bus[{other}].Mute=1;";
            Native.SetParameters(back);
            return ReadLocked(force: true);
        }
    }

    /// <summary>Mute or unmute the microphone's strip.</summary>
    /// <param name="force">
    /// After a write, Voicemeeter needs a moment to apply the script before the
    /// parameter cache reports the new values. Without this the POST response
    /// echoes the OLD state and the button visibly flips back before the next
    /// poll corrects it.
    /// </param>
    private AudioSnapshot ReadLocked(bool force = false)
    {
        if (!Connected()) return AudioSnapshot.Down();
        if (force)
        {
            Thread.Sleep(60);
            Native.IsParametersDirty();
        }

        var (hp, sp) = ResolveBuses();
        var headphones = Bus(hp);
        var speakers = Bus(sp);
        return new AudioSnapshot(
            true,
            true,
            headphones,
            speakers,
            // An unassigned bus counts as muted: nothing is coming out of it.
            LiveOutput(headphones?.Muted ?? true, speakers?.Muted ?? true));
    }

    private static AudioOutput? Bus(int index) => index < 0
        ? null
        : new AudioOutput(Text($"Bus[{index}].device.name"), Flag($"Bus[{index}].Mute"));

    /// <summary>
    /// Which physical bus is the headphones and which is the speakers, by device
    /// name — see the note on <see cref="HeadphoneNames"/>. Either can be -1,
    /// meaning nothing is assigned to that role yet and its button is dead.
    /// </summary>
    private static (int Headphones, int Speakers) ResolveBuses()
    {
        var headphones = -1;
        var speakers = -1;
        for (var i = 0; i < PhysicalBuses; i++)
        {
            var name = Text($"Bus[{i}].device.name")?.ToLowerInvariant();
            if (string.IsNullOrEmpty(name)) continue;
            if (headphones < 0 && HeadphoneNames.Any(name.Contains)) headphones = i;
            else if (speakers < 0 && SpeakerNames.Any(name.Contains)) speakers = i;
        }

        // A device neither list recognises still deserves a role rather than
        // vanishing: give it whichever one is still empty, lowest bus first.
        for (var i = 0; i < PhysicalBuses && (headphones < 0 || speakers < 0); i++)
        {
            if (i == headphones || i == speakers) continue;
            if (string.IsNullOrEmpty(Text($"Bus[{i}].device.name"))) continue;
            if (headphones < 0) headphones = i;
            else speakers = i;
        }
        return (headphones, speakers);
    }

    /// <summary>Which bus the room is hearing. Kept as a word, not two booleans,
    /// because the widget draws a segmented control and not two checkboxes.</summary>
    internal static string LiveOutput(bool headphonesMuted, bool speakersMuted) =>
        (headphonesMuted, speakersMuted) switch
        {
            (false, true) => "headphones",
            (true, false) => "speakers",
            (false, false) => "both",
            _ => "none",
        };

    /// <summary>
    /// Is the Voicemeeter server actually there, and refresh the parameter cache
    /// while we ask. A negative answer means the window is closed — which is a
    /// state to report, not an error, and one that fixes itself when you open
    /// it, so a stale login is retried rather than being fatal.
    /// </summary>
    private bool Connected()
    {
        var dirty = Native.IsParametersDirty();
        if (dirty >= 0) return true;

        if (DateTime.UtcNow - _lastLoginAttempt < ReloginAfter) return false;
        _lastLoginAttempt = DateTime.UtcNow;
        try
        {
            if (_loggedIn) Native.Logout();
            _loggedIn = Native.Login() >= 0;
            return _loggedIn && Native.IsParametersDirty() >= 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"voicemeeter: re-login failed: {ex.Message}");
            return false;
        }
    }

    private static bool Flag(string parameter) =>
        Native.GetParameterFloat(parameter, out var value) == 0 && value >= 0.5f;

    private static string? Text(string parameter)
    {
        var buffer = new byte[512];
        if (Native.GetParameterStringA(parameter, buffer) != 0) return null;
        var end = Array.IndexOf(buffer, (byte)0);
        var text = Encoding.ASCII.GetString(buffer, 0, end < 0 ? buffer.Length : end).Trim();
        return text.Length == 0 ? null : text;
    }

    /// <summary>
    /// --audio-dump. Every bus and strip as the API reports them, which is how the
    /// mapping above was written and the first thing to run when a button does
    /// nothing. Mirrors Vitals.Dump.
    /// </summary>
    public static void Dump()
    {
        Console.WriteLine($"dll        : {Locate() ?? "(not found)"}");
        int login;
        try
        {
            login = Native.Login();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"login      : failed — {ex.Message}");
            return;
        }

        Console.WriteLine($"login      : {login} ({LoginMeaning(login)})");
        if (login < 0) return;

        // Voicemeeter answers the first dirty poll with "everything changed"; the
        // values are only valid after it has been drained.
        for (var i = 0; i < 10 && Native.IsParametersDirty() == 1; i++) Thread.Sleep(50);

        Native.GetVoicemeeterType(out var type);
        Native.GetVoicemeeterVersion(out var version);
        Console.WriteLine($"type       : {type} ({TypeName(type)})");
        Console.WriteLine(
            $"version    : {(version >> 24) & 0xFF}.{(version >> 16) & 0xFF}."
            + $"{(version >> 8) & 0xFF}.{version & 0xFF}");
        Console.WriteLine($"running    : {(Native.IsParametersDirty() >= 0 ? "yes" : "no")}");
        Console.WriteLine();

        for (var i = 0; i < 5; i++)
        {
            Console.WriteLine(
                $"Bus[{i}]     : mute={(Flag($"Bus[{i}].Mute") ? 1 : 0)}  "
                + $"device=\"{Text($"Bus[{i}].device.name") ?? ""}\"");
        }
        Console.WriteLine();
        for (var i = 0; i < 5; i++)
        {
            Console.WriteLine(
                $"Strip[{i}]   : mute={(Flag($"Strip[{i}].Mute") ? 1 : 0)}  "
                + $"label=\"{Text($"Strip[{i}].label") ?? ""}\"  "
                + $"A1={Flag($"Strip[{i}].A1")} A2={Flag($"Strip[{i}].A2")} B1={Flag($"Strip[{i}].B1")}");
        }
        Console.WriteLine();
        var (hp, sp) = ResolveBuses();
        Console.WriteLine($"headphones : {(hp < 0 ? "(none assigned)" : $"Bus[{hp}]")}");
        Console.WriteLine($"speakers   : {(sp < 0 ? "(none assigned)" : $"Bus[{sp}]")}");
        Console.WriteLine(
            $"live       : {LiveOutput(hp < 0 || Flag($"Bus[{hp}].Mute"), sp < 0 || Flag($"Bus[{sp}].Mute"))}");

        Native.Logout();
    }

    private static string LoginMeaning(int code) => code switch
    {
        0 => "connected",
        1 => "connected, but Voicemeeter is not running",
        -1 => "cannot get client",
        -2 => "unexpected login (already logged in)",
        _ => "unknown",
    };

    private static string TypeName(int type) => type switch
    {
        1 => "Voicemeeter",
        2 => "Banana",
        3 => "Potato",
        _ => "unknown",
    };

    /// <summary>
    /// The installer records its own folder in the uninstall key, which is the
    /// only reliable way to find the DLL: it is never on PATH, the folder has a
    /// space in it, and a 64-bit process needs the 64-bit DLL out of a directory
    /// registered under WOW6432Node.
    /// </summary>
    private static string? Locate()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(InstallKey);
            var uninstall = key?.GetValue("UninstallString") as string;
            var dir = string.IsNullOrWhiteSpace(uninstall)
                ? FallbackDir
                : Path.GetDirectoryName(uninstall.Trim('"')) ?? FallbackDir;
            var path = Path.Combine(dir, Dll);
            if (File.Exists(path)) return path;
        }
        catch
        {
            // A missing key is just "not installed"; fall through to the default.
        }

        var fallback = Path.Combine(FallbackDir, Dll);
        return File.Exists(fallback) ? fallback : null;
    }

    public void Dispose()
    {
        if (!_loggedIn) return;
        try
        {
            lock (_gate) Native.Logout();
        }
        catch
        {
            // Shutting down; a mixer that already went away is not news.
        }
        _loggedIn = false;
    }

    /// <summary>
    /// VoicemeeterRemote's C API. The first P/Invoke in this project — everything
    /// else it talks to is either a WinRT projection or a NuGet package.
    ///
    /// Parameter names are ANSI, and the string getter writes into a caller-owned
    /// 512-byte buffer, which is the documented size. Returns are 0 for success
    /// and negative for failure throughout.
    /// </summary>
    private static class Native
    {
        static Native()
        {
            // The DllImport name below is a bare filename that Windows would never
            // find. This maps it to the absolute path once, for this assembly only.
            NativeLibrary.SetDllImportResolver(typeof(Voicemeeter).Assembly, (name, assembly, search) =>
            {
                if (!string.Equals(name, Dll, StringComparison.OrdinalIgnoreCase)) return IntPtr.Zero;
                var path = Locate();
                return path is null ? IntPtr.Zero : NativeLibrary.Load(path);
            });
        }

        [DllImport(Dll, EntryPoint = "VBVMR_Login")]
        public static extern int Login();

        [DllImport(Dll, EntryPoint = "VBVMR_Logout")]
        public static extern int Logout();

        [DllImport(Dll, EntryPoint = "VBVMR_GetVoicemeeterType")]
        public static extern int GetVoicemeeterType(out int type);

        [DllImport(Dll, EntryPoint = "VBVMR_GetVoicemeeterVersion")]
        public static extern int GetVoicemeeterVersion(out int version);

        /// <summary>1 = something changed, 0 = nothing, negative = no server.</summary>
        [DllImport(Dll, EntryPoint = "VBVMR_IsParametersDirty")]
        public static extern int IsParametersDirty();

        [DllImport(Dll, EntryPoint = "VBVMR_GetParameterFloat")]
        public static extern int GetParameterFloat(
            [MarshalAs(UnmanagedType.LPStr)] string parameter, out float value);

        [DllImport(Dll, EntryPoint = "VBVMR_GetParameterStringA")]
        public static extern int GetParameterStringA(
            [MarshalAs(UnmanagedType.LPStr)] string parameter, byte[] value);

        [DllImport(Dll, EntryPoint = "VBVMR_SetParameterFloat")]
        public static extern int SetParameterFloat(
            [MarshalAs(UnmanagedType.LPStr)] string parameter, float value);

        [DllImport(Dll, EntryPoint = "VBVMR_SetParameters")]
        public static extern int SetParameters([MarshalAs(UnmanagedType.LPStr)] string script);
    }
}
