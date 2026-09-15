using System.Runtime.InteropServices;
using System.Text;

namespace Dayboard.NowPlaying;

/// <summary>What /board answers, and what the deck's pin key draws itself from.</summary>
internal sealed record BoardSnapshot(bool Pinned, bool Found);

/// <summary>
/// Keeps the board on top of the taskbar, and gets out of the way when it should.
///
/// THE PROBLEM IT SOLVES IS A KVM SWITCH. A KVM's other monitors belong to a
/// second machine when it is flipped, which leaves the board's monitor as this
/// PC's ONLY display — so Windows relocates the taskbar onto it. The board is
/// launched `--start-fullscreen` (see scripts/_common.ps1) and a genuinely
/// fullscreen window is allowed to cover the taskbar, but that state does not
/// survive the display topology changing underneath it: Chrome comes back as an
/// ordinary window sized to the work area, and the work area is the screen minus
/// the taskbar. The bottom strip of the board is then simply gone.
///
/// So: re-assert. Every 15 seconds, put the window back in the topmost band and,
/// if its rectangle has drifted, back over the whole monitor.
///
/// AND YIELD, WHICH IS THE HALF THAT MAKES IT SAFE. A window that is
/// unconditionally on top of one monitor is a window that fights you the moment
/// you deliberately put something there — and this agent's own history is a
/// warning about exactly that, since the board's Chrome flags once leaked into
/// every browser window you opened. If the foreground window is something else
/// on the same monitor, this drops the board OUT of the topmost band and leaves
/// it alone until you look elsewhere.
///
/// SWP_NOACTIVATE EVERYWHERE. Re-asserting z-order must never steal focus; a
/// board that grabs the keyboard every fifteen seconds would be far worse than
/// a taskbar over its bottom edge.
///
/// GUARD ON THE WINDOW TITLE, NOT THE PROCESS. scripts/board.ps1 explains this at
/// length: a second launch against the same --user-data-dir hands the URL to the
/// browser already using it and exits, so the process that owns the window is
/// not the one whose command line carries --app=. The title comes from
/// src/app/layout.tsx.
///
/// THE MONITOR IS READ FROM THE WINDOW. Nothing here knows or cares that the
/// screen is 3440x1440.
/// </summary>
internal sealed class Board : IDisposable
{
    /// <summary>
    /// Slow on purpose. Nothing this fixes happens more than a few times a day,
    /// and the whole tick is a handful of user32 calls against windows that are
    /// almost always already correct.
    /// </summary>
    private const int IntervalMs = 15_000;

    /// <summary>From src/app/layout.tsx. Chrome's --app window takes the document title.</summary>
    private const string WindowTitle = "Dayboard";

    private readonly object _gate = new();
    private readonly Timer _tick;
    private bool _pinned;

    public Board(bool pinned)
    {
        _pinned = pinned;
        _tick = new Timer(_ => Enforce(), null, Timeout.Infinite, Timeout.Infinite);
    }

    /// <summary>First pass immediately: after a reboot the board is often already wrong.</summary>
    public void Start() => _tick.Change(0, IntervalMs);

    public BoardSnapshot Read()
    {
        // Looked up live rather than remembered from the last tick, so `found`
        // is an answer about now — the window can appear or go away between
        // ticks, and a stale false would have the deck's key lie for 15 seconds.
        var found = Find() != IntPtr.Zero;
        lock (_gate) { return new BoardSnapshot(_pinned, found); }
    }

    /// <summary>
    /// The manual override, for when yielding is not enough — or when you
    /// wants the monitor back for something else entirely. Takes effect at once
    /// rather than on the next tick, because a key you press and then wait
    /// fifteen seconds for is a key you press twice.
    /// </summary>
    public BoardSnapshot Set(string pin)
    {
        lock (_gate)
        {
            _pinned = pin switch
            {
                "on" => true,
                "off" => false,
                _ => !_pinned,
            };
        }
        Enforce();
        return Read();
    }

    public static string ToJson(BoardSnapshot s) =>
        $"{{\"pinned\":{(s.Pinned ? "true" : "false")},\"found\":{(s.Found ? "true" : "false")}}}";

    /* ------------------------------------------------------------ the tick -- */

    private void Enforce()
    {
        try
        {
            var hwnd = Find();
            if (hwnd == IntPtr.Zero) return;

            bool pinned;
            lock (_gate) { pinned = _pinned; }

            if (!pinned)
            {
                Unpin(hwnd);
                return;
            }

            var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);

            // Somebody else's window has the focus, on this same screen. Assume
            // it is there on purpose and stand down until it is not.
            var foreground = GetForegroundWindow();
            if (foreground != IntPtr.Zero
                && foreground != hwnd
                && !IsShell(foreground)
                && MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) == monitor)
            {
                Unpin(hwnd);
                return;
            }

            var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
            if (!GetMonitorInfoW(monitor, ref info)) return;

            // rcMonitor, NOT rcWork. The work area is the screen with the taskbar
            // subtracted, which is precisely the strip that has gone missing —
            // sizing to it would keep the board tidily out of its own way.
            var want = info.Monitor;

            // Only move it when it is actually wrong. Chrome re-lays out on every
            // SetWindowPos that carries a size, and doing that to a video wall
            // four times a minute for no reason would be its own bug.
            var flags = SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS;
            if (GetWindowRect(hwnd, out var now) && now.Equals(want))
            {
                flags |= SWP_NOMOVE | SWP_NOSIZE;
            }

            SetWindowPos(hwnd, HWND_TOPMOST, want.Left, want.Top,
                want.Right - want.Left, want.Bottom - want.Top, flags);
        }
        catch
        {
            // A window that vanished mid-tick, or a shell that refused. There is
            // nothing to report and another tick is fifteen seconds away.
        }
    }

    private static void Unpin(IntPtr hwnd) => SetWindowPos(
        hwnd, HWND_NOTOPMOST, 0, 0, 0, 0,
        SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_ASYNCWINDOWPOS);

    /* --------------------------------------------------------- the window -- */

    /// <summary>
    /// The visible window titled "Dayboard", or zero.
    ///
    /// EnumWindows rather than FindWindow because the class name is Chrome's and
    /// shared with every other Chrome window on the machine, so the title is the
    /// only thing that distinguishes the board — which is the same conclusion
    /// board.ps1 reached from the other direction.
    /// </summary>
    private static IntPtr Find()
    {
        var found = IntPtr.Zero;
        var title = new StringBuilder(256);

        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            title.Clear();
            if (GetWindowTextW(hwnd, title, title.Capacity) == 0) return true;
            if (!title.ToString().Equals(WindowTitle, StringComparison.Ordinal)) return true;
            found = hwnd;
            return false; // stop enumerating
        }, IntPtr.Zero);

        return found;
    }

    /// <summary>
    /// The desktop, the taskbar and the Start menu, which must not count as
    /// "something was put here".
    ///
    /// WITHOUT THIS THE FEATURE INVERTS ITSELF. On a machine whose only display
    /// is the board's, the desktop (Progman/WorkerW) frequently holds the
    /// foreground — and clicking Start hands it to Shell_TrayWnd, which is the
    /// taskbar this exists to get above. Treating either as a reason to yield
    /// would mean unpinning exactly when the taskbar is in the way.
    /// </summary>
    private static bool IsShell(IntPtr hwnd)
    {
        var name = new StringBuilder(128);
        if (GetClassNameW(hwnd, name, name.Capacity) == 0) return false;
        return name.ToString() switch
        {
            "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd"
                or "Windows.UI.Core.CoreWindow" or "XamlExplorerHostIslandWindow" => true,
            _ => false,
        };
    }

    public void Dispose() => _tick.Dispose();

    /* ----------------------------------------------------------- user32 ---- */

    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new(-2);

    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;

    /// <summary>
    /// Posts the change instead of waiting for the target to process it. Chrome
    /// hanging must not hang this agent's timer thread with it.
    /// </summary>
    private const uint SWP_ASYNCWINDOWPOS = 0x4000;

    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left, Top, Right, Bottom;
        public readonly bool Equals(Rect o) =>
            Left == o.Left && Top == o.Top && Right == o.Right && Bottom == o.Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public uint Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
    }

    private delegate bool EnumProc(IntPtr hwnd, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumProc callback, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr hwnd, StringBuilder name, int count);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(
        IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
