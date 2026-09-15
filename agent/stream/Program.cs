using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using static Dayboard.Stream.Native;

namespace Dayboard.Stream;

/// <summary>
/// Puts a real Chrome window INSIDE the board's window, where the Sports tab's
/// player sits, and keeps it there.
///
/// WHY A WINDOW AND NOT AN IFRAME. Every streaming service the fixtures point at
/// refuses to be framed (src/lib/embed.ts lists them, checked), and the only
/// thing on this machine that can decrypt their video is Chrome itself — WebView2
/// ships PlayReady and no Widevine. So the stream is a second Chrome, in its own
/// profile, launched --kiosk so it has no frame at all, and this program makes
/// that window a CHILD of the board window.
///
/// A CHILD, SPECIFICALLY, and each property of that is doing a job:
///   - it has no taskbar button, because only top-level windows get one;
///   - it moves, minimises and stacks with the board, so there is no z-order to
///     fight — Board.cs's topmost pin carries it along for free;
///   - it is clipped to the board and can never cover anything else;
///   - Chromium's own "a fullscreen window must fill its monitor" correction in
///     HWNDMessageHandler::OnWindowPosChanging is guarded by !GetParent(hwnd),
///     so a kiosk window that is a child can be any size we like.
///
/// WHAT CROSS-PROCESS PARENTING DOES NOT DO FOR FREE, found by testing it:
///   - KEYBOARD FOCUS. Windows attaches the two input queues, so mouse input
///     just works, but a click on the child leaves keyboard focus on the board
///     and a click on the board leaves it on the child. A low-level mouse hook
///     moves focus to whichever of the two was clicked.
///   - CHROME'S POPUPS. A &lt;select&gt; list, a permission bubble or a sign-in
///     popup is a separate top-level window, and the board is topmost, so they
///     open behind it. Each one of the stream's top-level windows is raised as
///     it appears; a titled one is also given the board as its owner so it gets
///     no taskbar button either.
///
/// PROTOCOL. One JSON object per line on stdin, one reply per line on stdout,
/// matched by `id`. The Next server (src/lib/stream-host.ts) is the only
/// caller; when it goes away stdin closes and this exits, leaving the window
/// exactly where it was so a server restart does not blink the stream.
/// </summary>
internal static class Program
{
    private const uint WM_COMMAND_READY = WM_APP + 1;
    private const uint WM_CLICK = WM_APP + 2;

    /// <summary>From src/app/layout.tsx, the same anchor agent/nowplaying/Board.cs uses.</summary>
    private const string BoardTitle = "Dayboard";

    private static readonly ConcurrentQueue<string> Inbox = new();
    private static uint _uiThread;

    // Kept in statics so the delegates the hooks hold are never collected.
    private static WinEventProc? _onWinEvent;
    private static HookProc? _onMouse;
    private static IntPtr _mouseHook;
    private static IntPtr _locationHook;

    private static uint _pid;
    private static IntPtr _board;
    private static IntPtr _current;
    private static readonly Stack<IntPtr> Behind = new();
    private static readonly HashSet<IntPtr> Owned = new();
    private static Rect? _want;
    private static bool _visible;
    /// <summary>Corner radius for the window's clip, in pixels. Zero is square.</summary>
    private static int _radius;
    private static string _regionKey = "";

    /// <summary>
    /// Rectangles cut out of the window, in the board's client pixels, each with
    /// its own corner radius: [x, y, w, h, r].
    ///
    /// FOR THE BOARD'S OWN PLAYER. The corner video (YouTube, Twitch) is DOM in
    /// the board's page, and a child window covers every pixel of its parent's
    /// page whatever the z-order — so dragged over the Music tab it went under
    /// music.apple.com. There is no order to put right there; the only way the
    /// page shows through a window is a hole in it.
    /// </summary>
    private static readonly List<(int X, int Y, int W, int H, int R)> _holes = new();
    private static bool _muted;
    private static int _ticks;

    /// <summary>
    /// Which window this copy keeps: "stream" (the Sports player) or "music" (the
    /// Music tab's music.apple.com). One copy per browser, each started by its own
    /// host in src/lib/stream-host.ts, all inside the one board window.
    ///
    /// ONLY THE STREAM INSISTS ON BEING ON TOP. The stream's corner player can sit
    /// over the Music tab, and two children that each put themselves first would
    /// swap places every half second — the flicker again. So the music window only
    /// has to be above the BOARD's own child windows, and leaves the stream above it.
    /// </summary>
    private static string _lane = "stream";
    private static bool Yields => _lane != "stream";

    public static int Main(string[] args)
    {
        for (var i = 0; i + 1 < args.Length; i++)
        {
            if (args[i] == "--lane") _lane = args[i + 1];
        }

        // Per-monitor v2, so every coordinate here is a physical pixel and means
        // the same thing as the board's CSS pixels times devicePixelRatio.
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        _uiThread = GetCurrentThreadId();

        _onWinEvent = OnWinEvent;
        SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_SHOW, IntPtr.Zero, _onWinEvent, 0, 0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);

        _onMouse = OnMouse;
        _mouseHook = SetWindowsHookExW(WH_MOUSE_LL, _onMouse, GetModuleHandleW(IntPtr.Zero), 0);

        // The hold. Chrome occasionally re-lays itself out (a display change, a
        // site leaving DOM fullscreen) and a popup can appear without a SHOW
        // event this process saw; half a second is well under what anyone notices.
        SetTimer(IntPtr.Zero, UIntPtr.Zero, 500, IntPtr.Zero);

        var reader = new Thread(ReadInput) { IsBackground = true, Name = "stdin" };
        reader.Start();

        Log($"ready, lane {_lane} (mouse hook {(_mouseHook == IntPtr.Zero ? "FAILED" : "on")})");

        while (GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            try
            {
                switch (msg.Message)
                {
                    case WM_COMMAND_READY:
                        while (Inbox.TryDequeue(out var line)) Handle(line);
                        break;
                    case WM_CLICK:
                        OnClick(msg.WParam.ToInt32(), msg.LParam.ToInt32());
                        break;
                    case WM_TIMER:
                        Hold();
                        break;
                    default:
                        TranslateMessage(ref msg);
                        DispatchMessageW(ref msg);
                        break;
                }
            }
            catch (Exception err)
            {
                Log("loop: " + err.Message);
            }
        }
        return 0;
    }

    /* ------------------------------------------------------------ protocol -- */

    private static void ReadInput()
    {
        string? line;
        while ((line = Console.In.ReadLine()) is not null)
        {
            if (line.Length == 0) continue;
            Inbox.Enqueue(line);
            PostThreadMessageW(_uiThread, WM_COMMAND_READY, IntPtr.Zero, IntPtr.Zero);
        }
        // The server is gone. Leave the window as it is and go.
        PostThreadMessageW(_uiThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    private static void Handle(string line)
    {
        JsonNode? id = null;
        string? error = null;
        try
        {
            var o = JsonNode.Parse(line)!.AsObject();
            id = o["id"]?.DeepClone();
            switch ((string?)o["cmd"])
            {
                case "expect":
                    Expect((uint)o["pid"]!);
                    break;
                case "place":
                    _want = new Rect
                    {
                        Left = (int)o["x"]!,
                        Top = (int)o["y"]!,
                        Right = (int)o["x"]! + Math.Max(1, (int)o["w"]!),
                        Bottom = (int)o["y"]! + Math.Max(1, (int)o["h"]!),
                    };
                    _radius = Math.Clamp((int?)o["r"] ?? 0, 0, 64);
                    _holes.Clear();
                    if (o["holes"] is JsonArray holes)
                    {
                        // Board client pixels, like x and y: [x, y, w, h, r].
                        foreach (var hole in holes.OfType<JsonArray>().Take(8))
                        {
                            if (hole.Count < 5) continue;
                            _holes.Add(((int)hole[0]!, (int)hole[1]!, Math.Max(1, (int)hole[2]!),
                                Math.Max(1, (int)hole[3]!), Math.Clamp((int)hole[4]!, 0, 64)));
                        }
                    }
                    Apply();
                    break;
                case "mute":
                    _muted = (bool)o["on"]!;
                    Log($"mute {(_muted ? "on" : "off")}: {Audio.SetMuted(_pid, _muted)} session(s)");
                    break;
                case "show":
                    _visible = (bool)o["on"]!;
                    Apply();
                    break;
                case "apply":
                    Apply(force: true);
                    break;
                case "focus":
                    if (_current != IntPtr.Zero) FocusTo(_current);
                    break;
                case "state":
                    break;
                default:
                    error = "unknown cmd";
                    break;
            }
        }
        catch (Exception err)
        {
            error = err.Message;
        }
        Reply(id, error);
    }

    private static void Reply(JsonNode? id, string? error)
    {
        var board = FindBoard();
        var reply = new JsonObject
        {
            ["id"] = id,
            ["ok"] = error is null,
            ["error"] = error,
            ["pid"] = _pid,
            ["board"] = board != IntPtr.Zero,
            ["adopted"] = _current != IntPtr.Zero && IsWindow(_current),
            ["visible"] = _current != IntPtr.Zero && IsWindowVisible(_current),
            ["muted"] = _muted,
        };
        if (board != IntPtr.Zero)
        {
            var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
            if (GetMonitorInfoW(MonitorFromWindow(board, MONITOR_DEFAULTTONEAREST), ref info))
            {
                reply["monitor"] = new JsonObject
                {
                    ["x"] = info.Monitor.Left,
                    ["y"] = info.Monitor.Top,
                    ["w"] = info.Monitor.Width,
                    ["h"] = info.Monitor.Height,
                };
            }
        }
        Console.Out.WriteLine(reply.ToJsonString());
        Console.Out.Flush();
    }

    private static void Log(string text)
    {
        Console.Error.WriteLine($"dayboard-stream: {text}");
        Console.Error.Flush();
    }

    /* ------------------------------------------------------------- windows -- */

    /// <summary>
    /// This Chrome process is the stream browser. Take whatever of it already
    /// exists: a child left behind by a previous run of this program, and any
    /// top-level window that has already appeared.
    /// </summary>
    private static void Expect(uint pid)
    {
        if (pid == _pid && _current != IntPtr.Zero && IsWindow(_current)) return;
        _pid = pid;
        _current = IntPtr.Zero;
        _regionKey = "";
        Behind.Clear();
        Owned.Clear();

        // Filtered to this process, because EVENT_OBJECT_LOCATIONCHANGE for the
        // whole desktop includes every movement of the mouse cursor. It is how a
        // kiosk window is caught the moment it goes fullscreen instead of on the
        // next half-second hold.
        if (_locationHook != IntPtr.Zero) UnhookWinEvent(_locationHook);
        _locationHook = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE,
            IntPtr.Zero, _onWinEvent!, pid, 0, WINEVENT_OUTOFCONTEXT);

        var board = FindBoard();
        if (board != IntPtr.Zero)
        {
            EnumChildWindows(board, (hwnd, _) =>
            {
                if (GetAncestor(hwnd, GA_PARENT) == board && PidOf(hwnd) == pid) _current = hwnd;
                return true;
            }, IntPtr.Zero);
        }

        // Left behind by a previous run of this program — which is what a server
        // restart looks like from here. Take it over exactly as it stands, so the
        // stream does not blink while the page gets round to saying where it goes.
        if (_current != IntPtr.Zero && board != IntPtr.Zero)
        {
            var at = new Point();
            ClientToScreen(board, ref at);
            GetWindowRect(_current, out var r);
            _want = new Rect { Left = r.Left - at.X, Top = r.Top - at.Y, Right = r.Right - at.X, Bottom = r.Bottom - at.Y };
            _visible = IsWindowVisible(_current);
        }
        Scan();
        Apply();
    }

    private static void OnWinEvent(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (idObject != 0 || idChild != 0 || hwnd == IntPtr.Zero || _pid == 0) return;
        try
        {
            if (evt == EVENT_OBJECT_DESTROY)
            {
                if (hwnd == _current)
                {
                    _current = IntPtr.Zero;
                    Apply();
                }
                Owned.Remove(hwnd);
                return;
            }
            if ((evt == EVENT_OBJECT_SHOW || evt == EVENT_OBJECT_LOCATIONCHANGE) && PidOf(hwnd) == _pid)
            {
                Classify(hwnd);
            }
        }
        catch (Exception err)
        {
            Log("winevent: " + err.Message);
        }
    }

    /// <summary>Every visible top-level window of the stream process, classified.</summary>
    private static void Scan()
    {
        if (_pid == 0) return;
        var found = new List<IntPtr>();
        EnumWindows((hwnd, _) =>
        {
            if (IsWindowVisible(hwnd) && PidOf(hwnd) == _pid) found.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        foreach (var hwnd in found) Classify(hwnd);
    }

    /// <summary>
    /// A browser window becomes the stream; anything else is a popup and goes
    /// on top of the board.
    ///
    /// A kiosk browser window is recognised by size: unowned and covering its
    /// monitor. That is a heuristic, and it is the honest one — Chromium gives
    /// its frames, menus and bubbles the same window class.
    ///
    /// NOTHING IS A POPUP UNTIL THERE IS A STREAM WINDOW. A kiosk window is shown
    /// at an ordinary size, with a caption, for a moment before it goes
    /// fullscreen — and treating that moment as a sign-in popup once pinned the
    /// whole window over the board as an owned topmost. A popup cannot exist
    /// before the window it pops out of, so until one has been adopted every
    /// window is left alone until it covers its monitor.
    /// </summary>
    private static void Classify(IntPtr hwnd)
    {
        if (hwnd == _current || !IsWindow(hwnd) || !IsWindowVisible(hwnd)) return;
        if (GetAncestor(hwnd, GA_PARENT) != GetDesktopWindow()) return;
        if (!ClassOf(hwnd).StartsWith("Chrome_WidgetWin", StringComparison.Ordinal)) return;

        var board = FindBoard();
        if (board == IntPtr.Zero) return;

        var owner = GetWindow(hwnd, GW_OWNER);
        var ours = owner == IntPtr.Zero || (owner == board && Owned.Contains(hwnd));
        if (ours && CoversMonitor(hwnd))
        {
            Owned.Remove(hwnd);
            Adopt(hwnd, board);
            return;
        }

        var streaming = _current != IntPtr.Zero && IsWindow(_current);
        if (!streaming) return;

        if (owner == IntPtr.Zero && (Style(hwnd) & WS_CAPTION) == WS_CAPTION && Owned.Add(hwnd))
        {
            // A titled window — a sign-in popup, most likely. Owned by the board
            // it has no taskbar button and stays above it. The hide/show is what
            // makes the shell drop the button it already made.
            ShowWindow(hwnd, SW_HIDE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new IntPtr(Style(hwnd, GWL_EXSTYLE) & ~WS_EX_APPWINDOW));
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, board);
            ShowWindow(hwnd, SW_SHOW);
        }

        if ((Style(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST) == 0)
        {
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    private static bool CoversMonitor(IntPtr hwnd)
    {
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        if (!GetWindowRect(hwnd, out var r)) return false;
        if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref info)) return false;
        return r.Width >= info.Monitor.Width * 0.9 && r.Height >= info.Monitor.Height * 0.9;
    }

    private static void Adopt(IntPtr hwnd, IntPtr board)
    {
        // Hidden first, so the reparent and the resize happen off screen and the
        // wall sees one frame of it at most.
        ShowWindow(hwnd, SW_HIDE);

        var style = Style(hwnd);
        style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZE | WS_MAXIMIZE);
        style |= WS_CHILD;
        SetWindowLongPtrW(hwnd, GWL_STYLE, new IntPtr(style));
        SetParent(hwnd, board);

        // A second browser window (window.open, a new-window link) goes in front;
        // the one it replaced waits behind and comes back when it closes.
        if (_current != IntPtr.Zero && IsWindow(_current))
        {
            ShowWindow(_current, SW_HIDE);
            Behind.Push(_current);
        }
        _current = hwnd;
        _regionKey = "";
        Log($"adopted 0x{hwnd.ToInt64():X}");
        Apply(force: true);
    }

    /// <summary>Make the child match what was asked for. Idempotent and cheap.</summary>
    private static void Apply(bool force = false)
    {
        if (_current != IntPtr.Zero && !IsWindow(_current)) _current = IntPtr.Zero;
        while (_current == IntPtr.Zero && Behind.Count > 0)
        {
            var next = Behind.Pop();
            if (IsWindow(next)) _current = next;
        }
        if (_current == IntPtr.Zero) return;

        var board = FindBoard();
        if (board == IntPtr.Zero) return;

        // CHROME PUTS ITS OLD STYLE BACK whenever the window leaves fullscreen —
        // the style it saved before it was ever a child, WS_CHILD missing. A
        // window without WS_CHILD reports its OWNER from GetParent, so testing
        // GetParent here once re-parented the window every half second, and
        // every re-parent is a repaint: the board flickered. The real parent is
        // GetAncestor's, and the style is put right on its own, without moving
        // anything.
        var style = Style(_current);
        const long notChild = WS_POPUP | WS_CAPTION | WS_THICKFRAME;
        if ((style & WS_CHILD) == 0 || (style & notChild) != 0)
        {
            SetWindowLongPtrW(_current, GWL_STYLE, new IntPtr((style & ~notChild) | WS_CHILD));
            force = true;
        }
        if (GetAncestor(_current, GA_PARENT) != board)
        {
            SetParent(_current, board);
            force = true;
        }

        if (_want is { } want)
        {
            var at = new Point();
            ClientToScreen(board, ref at);
            GetWindowRect(_current, out var now);
            var moved = now.Left - at.X != want.Left || now.Top - at.Y != want.Top
                || now.Width != want.Width || now.Height != want.Height;
            // On top of the board's own child windows too — Chrome keeps a couple.
            var onTop = Yields ? AboveBoard(board) : GetWindow(board, GW_CHILD) == _current;
            if (force || moved || !onTop)
            {
                // A yielding window that is already where it belongs keeps its
                // place in the stack, so a resize never lifts it over the stream.
                var after = onTop && Yields ? IntPtr.Zero : Yields ? JustAboveBoard(board) : HWND_TOP;
                SetWindowPos(_current, after, want.Left, want.Top, want.Width, want.Height,
                    SWP_NOACTIVATE | SWP_FRAMECHANGED | (onTop && Yields ? SWP_NOZORDER : 0));
            }
        }

        // ROUNDED TO MATCH THE CORNER PLAYER. CSS rounds the page's own corner
        // player, but this is a window over it, and a window is a rectangle
        // unless it is given a region. Only the top corners: the bottom edge of
        // the picture meets the player's bar, which is square. The rectangle is
        // extended below the window by a radius so its lower corners fall
        // outside it.
        if (_want is { } size)
        {
            var key = $"{size.Width}x{size.Height}r{_radius}@{size.Left},{size.Top}h{string.Join(";", _holes)}";
            if (force || key != _regionKey)
            {
                var region = IntPtr.Zero;
                if (_radius > 0)
                {
                    region = CreateRoundRectRgn(0, 0, size.Width + 1, size.Height + _radius * 2 + 1,
                        _radius * 2, _radius * 2);
                }
                else if (_holes.Count > 0)
                {
                    region = CreateRectRgn(0, 0, size.Width, size.Height);
                }

                foreach (var hole in _holes)
                {
                    // Into the window's own coordinates, which is what a region is in.
                    var left = hole.X - size.Left;
                    var top = hole.Y - size.Top;
                    var cut = CreateRoundRectRgn(left, top, left + hole.W + 1, top + hole.H + 1, hole.R * 2, hole.R * 2);
                    CombineRgn(region, region, cut, RGN_DIFF);
                    DeleteObject(cut);
                }

                if (region == IntPtr.Zero) SetWindowRgn(_current, IntPtr.Zero, true);
                else if (SetWindowRgn(_current, region, true) == 0) DeleteObject(region);
                _regionKey = key;
            }
        }

        var show = _visible && _want is not null;
        if (show != IsWindowVisible(_current)) ShowWindow(_current, show ? SW_SHOWNA : SW_HIDE);
    }

    /// <summary>
    /// Another lane's browser window: a Chrome frame adopted from a process that
    /// is not the board's. Everything else in the board — its render widgets, and
    /// the GPU process's surfaces, which carry neither browser's process id — is
    /// the board's own.
    /// </summary>
    private static bool IsLane(IntPtr hwnd, uint boardPid) =>
        PidOf(hwnd) != boardPid && ClassOf(hwnd).StartsWith("Chrome_WidgetWin", StringComparison.Ordinal);

    /// <summary>Nothing but other lanes' windows is stacked above this one.</summary>
    private static bool AboveBoard(IntPtr board)
    {
        var boardPid = PidOf(board);
        for (var above = GetWindow(_current, GW_HWNDPREV); above != IntPtr.Zero; above = GetWindow(above, GW_HWNDPREV))
        {
            if (!IsLane(above, boardPid)) return false;
        }
        return true;
    }

    /// <summary>
    /// Where to insert so this window lands directly above the board's topmost
    /// own child: behind whatever is above that child (another lane's window), or
    /// at the top when nothing is.
    /// </summary>
    private static IntPtr JustAboveBoard(IntPtr board)
    {
        var boardPid = PidOf(board);
        for (var child = GetWindow(board, GW_CHILD); child != IntPtr.Zero; child = GetWindow(child, GW_HWNDNEXT))
        {
            if (child == _current || IsLane(child, boardPid)) continue;
            var above = GetWindow(child, GW_HWNDPREV);
            // Already right there: stay behind whatever is above this window.
            if (above == _current) above = GetWindow(_current, GW_HWNDPREV);
            return above == IntPtr.Zero ? HWND_TOP : above;
        }
        return HWND_TOP;
    }

    private static void Hold()
    {
        if (_pid == 0) return;
        Apply();
        Scan();
        // Once a second, the mute: Chrome makes a new audio session whenever a
        // page starts playing, and a new session starts unmuted.
        if (++_ticks % 2 == 0) Audio.SetMuted(_pid, _muted);
    }

    private static IntPtr FindBoard()
    {
        if (_board != IntPtr.Zero && IsWindow(_board) && TitleOf(_board) == BoardTitle) return _board;
        _board = IntPtr.Zero;
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) || TitleOf(hwnd) != BoardTitle) return true;
            _board = hwnd;
            return false;
        }, IntPtr.Zero);
        return _board;
    }

    /* --------------------------------------------------------------- focus -- */

    private static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
    {
        // Nothing but a post: a low-level hook that takes its time gets removed
        // by Windows, and every click on the machine waits on it.
        if (code >= 0 && _current != IntPtr.Zero)
        {
            var message = wParam.ToInt32();
            if (message is WM_LBUTTONDOWN or WM_RBUTTONDOWN or WM_MBUTTONDOWN)
            {
                var data = Marshal.PtrToStructure<MouseLL>(lParam);
                PostThreadMessageW(_uiThread, WM_CLICK, new IntPtr(data.Pt.X), new IntPtr(data.Pt.Y));
            }
        }
        return CallNextHookEx(_mouseHook, code, wParam, lParam);
    }

    private static void OnClick(int x, int y)
    {
        if (_current == IntPtr.Zero || !IsWindow(_current)) return;
        var board = FindBoard();
        if (board == IntPtr.Zero) return;

        var under = WindowFromPoint(new Point { X = x, Y = y });
        var focus = FocusedIn(board);
        // Any window of the stream's process counts, not just the child: an open
        // <select> list holds the focus itself, and taking it back to the child
        // closes the list the instant it opens.
        var inStream = focus != IntPtr.Zero && (focus == _current || IsChild(_current, focus) || PidOf(focus) == _pid);

        // BY THE WINDOW CLICKED, NOT BY THE RECTANGLE. With the music window and
        // the stream both in the board, the stream's corner player can sit inside
        // the music window's rectangle — and a rectangle test had both helpers
        // taking focus for the same click.
        // Resolved to the board's direct child it sits in, because the window under
        // a pixel can be Chrome's GPU-process surface, whose process id is neither
        // browser's.
        var root = BoardChildOf(under, board);
        if (root == _current)
        {
            if (IsWindowVisible(_current) && !inStream) FocusTo(_current);
            return;
        }

        // A click on one of this browser's own popups is still a click on it.
        if (under != IntPtr.Zero && PidOf(under) == _pid) return;

        // Another lane's window: its own helper is handling this click.
        if (root != IntPtr.Zero && IsLane(root, PidOf(board))) return;

        if (inStream && GetWindowRect(board, out var b) && b.Contains(x, y)) FocusTo(board);
    }

    /// <summary>The child of the board that `hwnd` is, or is inside; zero if it is not in the board.</summary>
    private static IntPtr BoardChildOf(IntPtr hwnd, IntPtr board)
    {
        for (var at = hwnd; at != IntPtr.Zero; at = GetAncestor(at, GA_PARENT))
        {
            var parent = GetAncestor(at, GA_PARENT);
            if (parent == board) return at;
            if (parent == IntPtr.Zero || parent == GetDesktopWindow()) return IntPtr.Zero;
        }
        return IntPtr.Zero;
    }

    private static IntPtr FocusedIn(IntPtr board)
    {
        var info = new GuiThreadInfo { Size = Marshal.SizeOf<GuiThreadInfo>() };
        return GetGUIThreadInfo(ThreadOf(board), ref info) ? info.Focus : IntPtr.Zero;
    }

    private static void FocusTo(IntPtr hwnd)
    {
        var me = GetCurrentThreadId();
        var them = ThreadOf(hwnd);
        AttachThreadInput(me, them, true);
        SetFocus(hwnd);
        AttachThreadInput(me, them, false);
    }
}
