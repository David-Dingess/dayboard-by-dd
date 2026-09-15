using System.Buffers.Binary;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NAudio.Dsp;
using NAudio.Wave;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Dayboard.NowPlaying;

/*
 * What Wallpaper Engine is doing, and what this does too.
 *
 * Windows keeps one system-wide registry of "something is playing" — the System
 * Media Transport Controls (SMTC), the thing behind the volume-key flyout. Every
 * well-behaved player publishes to it, which is why a wallpaper can show album
 * art for Spotify, a browser tab and Apple Music without knowing anything about
 * any of them. Apple Music for Windows publishes title, artist and a real
 * thumbnail; that was verified on this machine before a line of this was written.
 *
 * SMTC carries no audio, only metadata — so the EQ is a second, unrelated
 * mechanism: WASAPI loopback capture of the default render device, windowed FFT,
 * folded into a handful of log-spaced bands.
 *
 * Both are local facts about one PC, and the board's server may be anywhere, so this
 * process is the bridge: a tiny HTTP server on the loopback address that the
 * browser — sitting on the same machine — reads directly. Loopback is
 * "potentially trustworthy" to Chrome, so an HTTPS page may read plain HTTP from
 * 127.0.0.1 without tripping the mixed-content blocker. That is the whole trick.
 *
 * Raw TcpListener rather than HttpListener on purpose: http.sys wants a URL ACL
 * reservation, which wants an elevated prompt once per machine. A socket wants
 * nothing, and three routes with no request bodies is not enough HTTP to be
 * worth a click through UAC.
 */

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var port = 7343;
        // Follow whatever Windows considers the current media session; --app
        // pins it to one player instead (a substring of the app id).
        string? preferred = null;
        var origins = new List<string>();
        // On by default: a taskbar over the bottom of the board is the state this
        // exists to prevent. See Board.
        var pin = true;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--port" when i + 1 < args.Length:
                    port = int.Parse(args[++i], CultureInfo.InvariantCulture);
                    break;
                case "--app" when i + 1 < args.Length:
                    // Substring matched against the app id. "--app any" follows
                    // whatever Windows considers the current session instead.
                    preferred = args[++i];
                    if (preferred.Equals("any", StringComparison.OrdinalIgnoreCase)) preferred = null;
                    break;
                case "--origin" when i + 1 < args.Length:
                    origins.Add(args[++i].TrimEnd('/'));
                    break;
                case "--dump-sensors":
                    // Prints every sensor and exits. What the /vitals mapping was
                    // written against — see Vitals.Dump.
                    Vitals.Dump();
                    return 0;
                case "--audio-dump":
                    // The same idea for the mixer: every bus and strip as the
                    // Remote API reports them. Run it from a normal shell AND an
                    // elevated one — see Voicemeeter.Dump.
                    Voicemeeter.Dump();
                    return 0;
                case "--dump-processes":
                    // Two samples and the grouped result, which is the only way to
                    // see whether a CPU figure is believable — see Processes.Dump.
                    await Processes.DumpAsync();
                    return 0;
                case "--no-pin":
                    // A starting position, not a kill switch: POST /board turns
                    // it back on without restarting anything.
                    pin = false;
                    break;
                case "--headphones" when i + 1 < args.Length:
                    // Comma-separated fragments of the Voicemeeter device names
                    // that mean "headphones" — see Voicemeeter.Configure.
                    Voicemeeter.Configure(headphones: args[++i]);
                    break;
                case "--speakers" when i + 1 < args.Length:
                    Voicemeeter.Configure(speakers: args[++i]);
                    break;
                case "--help":
                case "-h":
                    Console.WriteLine(
                        "dayboard-nowplaying [--port 7343] [--app any|Spotify|AppleMusic] [--origin http://...]\n"
                        + "                    [--no-pin] [--headphones a,b] [--speakers c,d]\n"
                        + "                    [--dump-sensors] [--audio-dump] [--dump-processes]");
                    return 0;
            }
        }

        if (origins.Count == 0)
        {
            // The board's default port, both spellings, and the dev server's.
            // Anything else has to say so, because an open CORS policy would let
            // any tab on the internet read what is playing on this machine. The
            // scheduled task passes --origin explicitly from the configured port.
            origins.Add("http://localhost:6767");
            origins.Add("http://127.0.0.1:6767");
            origins.Add("http://localhost:3000");
            origins.Add("http://127.0.0.1:3000");
        }

        using var media = new MediaWatcher(preferred);
        await media.StartAsync();

        using var levels = new LevelMeter();
        levels.Start();

        using var vitals = new Vitals();
        vitals.Start();

        using var audio = new Voicemeeter();

        using var procs = new Processes();
        procs.Start();

        using var claude = new Claude();
        claude.Start();

        using var sessions = new ClaudeSessions();

        using var board = new Board(pin);
        board.Start();

        var server = new HttpServer(
            port, origins, media, levels, vitals, audio, procs, claude, sessions, board);
        Console.WriteLine($"dayboard-nowplaying on http://127.0.0.1:{port}");
        Console.WriteLine($"  following : {preferred ?? "(current session)"}");
        Console.WriteLine($"  origins   : {string.Join(", ", origins)}");
        Console.WriteLine($"  levels    : {(levels.Available ? "WASAPI loopback" : "unavailable")}");
        Console.WriteLine($"  vitals    : {VitalsLine(vitals)}");
        Console.WriteLine($"  audio     : {(audio.Available ? "Voicemeeter" : "unavailable")}");
        Console.WriteLine($"  claude    : {(claude.Available ? Claude.CredentialsPath() : "no credentials — run `claude` once")}");
        Console.WriteLine($"  board     : {(pin ? "kept on top" : "not pinned (--no-pin)")}");

        await server.RunAsync(CancellationToken.None);
        return 0;
    }

    /// <summary>
    /// Says at a glance which half of /vitals this run can actually see. Started
    /// from the Start Menu you get load and the GPU; started by the scheduled
    /// task at -RunLevel Highest you also get temperatures and fans.
    /// </summary>
    private static string VitalsLine(Vitals vitals) => !vitals.Available
        ? "unavailable"
        : vitals.Elevated
            ? "full (elevated)"
            : "load, memory and GPU only — not elevated, so no CPU temp or case fans";
}

/// <summary>What the browser is told about the current track.</summary>
internal sealed record Snapshot(
    bool Ok,
    string? Source,
    string? App,
    string? Title,
    string? Artist,
    string? Album,
    string? AlbumArtist,
    string Status,
    long PositionMs,
    long DurationMs,
    string PositionAt,
    string? ArtUrl,
    string UpdatedAt);

/// <summary>
/// Follows one SMTC session and keeps the latest metadata and cover art in
/// memory. Event-driven, with a slow poll behind it because a player that dies
/// without tidying up leaves its last event standing.
/// </summary>
internal sealed class MediaWatcher : IDisposable
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly string? _preferred;
    private readonly object _gate = new();
    private readonly Timer _poll;

    private GlobalSystemMediaTransportControlsSessionManager? _manager;
    private GlobalSystemMediaTransportControlsSession? _session;
    private Snapshot _snapshot = Empty();
    private Snapshot _lastSent = Empty();
    private byte[] _art = Array.Empty<byte>();
    private string _artType = "image/png";
    private string _artVersion = "0";

    public MediaWatcher(string? preferred)
    {
        _preferred = preferred;
        _poll = new Timer(_ => _ = RefreshAsync(), null, Timeout.Infinite, Timeout.Infinite);
    }

    public event Action<Snapshot>? Changed;

    public Snapshot Current { get { lock (_gate) { return _snapshot; } } }

    public (byte[] Bytes, string ContentType, string Version) Art
    {
        get { lock (_gate) { return (_art, _artType, _artVersion); } }
    }

    public static string ToJson(Snapshot s) => JsonSerializer.Serialize(s, Json);

    /// <summary>
    /// Drive the session being listened to: play, pause, next, previous.
    ///
    /// THE FIRST WRITE TO THE MEDIA SESSION. Everything else in this class reads.
    /// The session reference is taken under the lock and let go before the await,
    /// because you cannot await inside a C# lock and because BindAsync replaces
    /// that field from an event callback — so the object has to be pinned in a
    /// local first, and may well be dead by the time the call lands.
    ///
    /// False means "nothing is playing", "the app refused" or "the session went
    /// away mid-call". The caller cannot tell those apart and does not need to:
    /// the next `track` event says what is actually true, and Publish compares
    /// Status, so a play or a pause pushes one within the poll interval.
    /// </summary>
    public async Task<bool> ControlAsync(string command)
    {
        GlobalSystemMediaTransportControlsSession? session;
        lock (_gate) { session = _session; }
        if (session is null) return false;

        try
        {
            return command switch
            {
                "play" => await session.TryPlayAsync(),
                "pause" => await session.TryPauseAsync(),
                "next" => await session.TrySkipNextAsync(),
                "previous" => await session.TrySkipPreviousAsync(),
                _ => false,
            };
        }
        catch (Exception)
        {
            // The player closed between the read above and the call. Not news —
            // the next refresh will notice the session is gone.
            return false;
        }
    }

    private static Snapshot Empty() => new(
        false, null, null, null, null, null, null, "Closed", 0, 0,
        DateTimeOffset.UtcNow.ToString("o"), null, DateTimeOffset.UtcNow.ToString("o"));

    public async Task StartAsync()
    {
        _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        _manager.SessionsChanged += (_, _) => _ = BindAsync();
        _manager.CurrentSessionChanged += (_, _) => _ = BindAsync();
        await BindAsync();
        // Cheap insurance, not the main path: the events above carry every change.
        _poll.Change(TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(3));
    }

    /// <summary>
    /// Pick the session to follow. Pinning one app means a football
    /// stream in a browser tab is also an SMTC session — so a name filter beats
    /// "whatever is current", which would flip the panel to the game.
    /// </summary>
    private async Task BindAsync()
    {
        try
        {
            if (_manager is null) return;

            GlobalSystemMediaTransportControlsSession? next = null;
            if (_preferred is not null)
            {
                foreach (var candidate in _manager.GetSessions())
                {
                    if (candidate.SourceAppUserModelId.Contains(_preferred, StringComparison.OrdinalIgnoreCase))
                    {
                        next = candidate;
                        break;
                    }
                }
            }
            next ??= _manager.GetCurrentSession();

            if (!ReferenceEquals(next, _session))
            {
                Unhook();
                _session = next;
                if (_session is not null)
                {
                    _session.MediaPropertiesChanged += OnChanged;
                    _session.PlaybackInfoChanged += OnChanged;
                    _session.TimelinePropertiesChanged += OnChanged;
                }
            }

            await RefreshAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"bind: {ex.Message}");
        }
    }

    private void OnChanged(GlobalSystemMediaTransportControlsSession sender, object args) => _ = RefreshAsync();

    private async Task RefreshAsync()
    {
        var session = _session;
        if (session is null)
        {
            Publish(Empty(), null, null);
            return;
        }

        try
        {
            var props = await session.TryGetMediaPropertiesAsync();
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();

            var title = Blank(props.Title);
            var artist = Blank(props.Artist);
            var album = Blank(props.AlbumTitle);
            var albumArtist = Blank(props.AlbumArtist);

            // Observed on this machine: Apple Music leaves AlbumTitle empty and
            // packs "Artist — Album" into Artist. Only unpick it when the album is
            // genuinely missing, so a player that tags properly is left alone and
            // an artist with a dash in their name survives.
            if (album is null && artist is not null)
            {
                var cut = artist.IndexOf(" — ", StringComparison.Ordinal);
                if (cut < 0) cut = artist.IndexOf(" – ", StringComparison.Ordinal);
                if (cut > 0)
                {
                    album = artist.Substring(cut + 3).Trim();
                    artist = artist.Substring(0, cut).Trim();
                    if (albumArtist is not null && albumArtist.StartsWith(artist, StringComparison.Ordinal))
                    {
                        albumArtist = artist;
                    }
                }
            }

            var art = await ReadThumbnailAsync(props);

            var snapshot = new Snapshot(
                Ok: title is not null,
                Source: session.SourceAppUserModelId,
                App: FriendlyApp(session.SourceAppUserModelId),
                Title: title,
                Artist: artist,
                Album: album,
                AlbumArtist: albumArtist,
                Status: playback.PlaybackStatus.ToString(),
                PositionMs: (long)timeline.Position.TotalMilliseconds,
                DurationMs: (long)timeline.EndTime.TotalMilliseconds,
                // The browser extrapolates the progress bar from this instant, so
                // it must be when Windows sampled the position, not when we asked.
                PositionAt: timeline.LastUpdatedTime.ToUniversalTime().ToString("o"),
                ArtUrl: null,
                UpdatedAt: DateTimeOffset.UtcNow.ToString("o"));

            Publish(snapshot, art.Bytes, art.ContentType);
        }
        catch (Exception ex)
        {
            // A player closing mid-call throws an RPC error. That is a state, not
            // a crash: report nothing playing and wait for the next event.
            Console.Error.WriteLine($"refresh: {ex.Message}");
            Publish(Empty(), null, null);
        }
    }

    private static async Task<(byte[]? Bytes, string? ContentType)> ReadThumbnailAsync(
        GlobalSystemMediaTransportControlsSessionMediaProperties props)
    {
        if (props.Thumbnail is null) return (null, null);
        try
        {
            using var stream = await props.Thumbnail.OpenReadAsync();
            if (stream.Size == 0 || stream.Size > 12 * 1024 * 1024) return (null, null);
            var bytes = new byte[stream.Size];
            using var reader = new DataReader(stream.GetInputStreamAt(0));
            await reader.LoadAsync((uint)stream.Size);
            reader.ReadBytes(bytes);
            // Observed: SMTC returns "image/jpeg,image/jpe,image/jpg" — a list of
            // every alias, not a media type. A browser rejects that, so take the
            // first and let the sniffer cover the empty case.
            var declared = stream.ContentType?.Split(',')[0].Trim();
            var type = string.IsNullOrEmpty(declared) ? Sniff(bytes) : declared;
            return (bytes, type);
        }
        catch
        {
            // No art is a layout without a square, never a failure.
            return (null, null);
        }
    }

    /// <summary>SMTC sometimes hands over an empty ContentType; the bytes never lie.</summary>
    private static string Sniff(byte[] b)
    {
        if (b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8) return "image/jpeg";
        if (b.Length > 8 && BinaryPrimitives.ReadUInt64BigEndian(b) == 0x89504E470D0A1A0AUL) return "image/png";
        return "application/octet-stream";
    }

    private void Publish(Snapshot snapshot, byte[]? art, string? artType)
    {
        Snapshot published;
        lock (_gate)
        {
            if (art is not null && art.Length > 0)
            {
                var version = Convert.ToHexString(SHA256.HashData(art), 0, 6).ToLowerInvariant();
                if (version != _artVersion)
                {
                    _art = art;
                    _artType = artType ?? "image/png";
                    _artVersion = version;
                }
            }
            else if (!snapshot.Ok)
            {
                _art = Array.Empty<byte>();
                _artVersion = "0";
            }

            published = snapshot with
            {
                // Versioned so the browser can cache the art forever and still
                // swap it the instant the track changes.
                ArtUrl = _art.Length > 0 ? $"/art?v={_artVersion}" : null,
            };

            // Compared against the last snapshot actually SENT, not the last one
            // seen. Apple Music reports the timeline about once a second; against
            // "last seen" every step is under the threshold, so the stream would
            // fall silent after the first event of each track and the progress bar
            // would never learn the duration. /nowplaying was always right, which
            // is what made this worth being careful about.
            var same =
                _lastSent.Title == published.Title &&
                _lastSent.Artist == published.Artist &&
                _lastSent.Album == published.Album &&
                _lastSent.Status == published.Status &&
                _lastSent.ArtUrl == published.ArtUrl &&
                _lastSent.DurationMs == published.DurationMs &&
                Math.Abs(_lastSent.PositionMs - published.PositionMs) < 1500;

            _snapshot = published;
            if (same) return;
            _lastSent = published;
        }

        Changed?.Invoke(published);
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string FriendlyApp(string aumid)
    {
        if (aumid.Contains("AppleMusic", StringComparison.OrdinalIgnoreCase)) return "Apple Music";
        if (aumid.Contains("Spotify", StringComparison.OrdinalIgnoreCase)) return "Spotify";
        if (aumid.Contains("iTunes", StringComparison.OrdinalIgnoreCase)) return "iTunes";
        if (aumid.Contains("Chrome", StringComparison.OrdinalIgnoreCase)) return "Chrome";
        if (aumid.Contains("firefox", StringComparison.OrdinalIgnoreCase)) return "Firefox";
        if (aumid.Contains("msedge", StringComparison.OrdinalIgnoreCase)) return "Edge";
        if (aumid.Contains("vlc", StringComparison.OrdinalIgnoreCase)) return "VLC";
        var cut = aumid.IndexOf('!');
        return cut > 0 ? aumid.Substring(0, cut) : aumid;
    }

    private void Unhook()
    {
        if (_session is null) return;
        _session.MediaPropertiesChanged -= OnChanged;
        _session.PlaybackInfoChanged -= OnChanged;
        _session.TimelinePropertiesChanged -= OnChanged;
    }

    public void Dispose()
    {
        _poll.Dispose();
        Unhook();
    }
}

/// <summary>
/// The EQ. WASAPI loopback hands us exactly what the speakers are getting, so
/// this reacts to everything — Apple Music, a browser tab, a game — regardless of
/// which app the metadata above is following.
///
/// Bands are log-spaced because hearing is: a linear split would spend twenty of
/// its twenty-four bars on the top two octaves, where music mostly is not.
/// </summary>
internal sealed class LevelMeter : IDisposable
{
    public const int Bands = 24;

    private const int FftSize = 2048;          // ~21 Hz per bin at 44.1k, plenty low
    private const int FftOrder = 11;           // log2(FftSize)
    private const float Floor = -70f;          // dBFS treated as silence
    private const float Attack = 0.55f;        // how fast a bar jumps up
    private const float Decay = 0.12f;         // and how lazily it falls

    private readonly float[] _bands = new float[Bands];
    private readonly Complex[] _fft = new Complex[FftSize];
    private readonly float[] _window = new float[FftSize];
    private readonly float[] _ring = new float[FftSize];
    private readonly object _gate = new();

    private WasapiLoopbackCapture? _capture;
    private int _ringAt;
    private int _sampleRate = 48000;

    public bool Available { get; private set; }

    public LevelMeter()
    {
        for (var i = 0; i < FftSize; i++) _window[i] = (float)FastFourierTransform.HammingWindow(i, FftSize);
    }

    public void Start()
    {
        try
        {
            _capture = new WasapiLoopbackCapture();
            _sampleRate = _capture.WaveFormat.SampleRate;
            _capture.DataAvailable += OnData;
            // Losing the device (unplugging headphones) must not take the panel
            // down with it — reconnect on the next track change instead.
            _capture.RecordingStopped += (_, _) => Available = false;
            _capture.StartRecording();
            Available = true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"levels: {ex.Message} (EQ disabled, metadata unaffected)");
            Available = false;
        }
    }

    /// <summary>A copy of the current bars, 0..1, safe to hand to a socket.</summary>
    public float[] Read()
    {
        lock (_gate)
        {
            var copy = new float[Bands];
            Array.Copy(_bands, copy, Bands);
            return copy;
        }
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        var format = _capture?.WaveFormat;
        if (format is null || format.BitsPerSample != 32) return;

        var channels = Math.Max(1, format.Channels);
        var frames = e.BytesRecorded / (4 * channels);

        // Mono-sum into a ring buffer: an EQ of the mix, not of the left speaker.
        for (var f = 0; f < frames; f++)
        {
            var sum = 0f;
            for (var c = 0; c < channels; c++)
            {
                sum += BitConverter.ToSingle(e.Buffer, (f * channels + c) * 4);
            }
            _ring[_ringAt] = sum / channels;
            _ringAt = (_ringAt + 1) % FftSize;
        }

        if (frames > 0) Analyse();
    }

    private void Analyse()
    {
        for (var i = 0; i < FftSize; i++)
        {
            var sample = _ring[(_ringAt + i) % FftSize];
            _fft[i].X = sample * _window[i];
            _fft[i].Y = 0f;
        }

        FastFourierTransform.FFT(true, FftOrder, _fft);

        var binHz = (double)_sampleRate / FftSize;
        var lowest = 40.0;
        var highest = Math.Min(16000.0, _sampleRate / 2.0 - binHz);
        var ratio = Math.Pow(highest / lowest, 1.0 / Bands);

        lock (_gate)
        {
            var edge = lowest;
            for (var b = 0; b < Bands; b++)
            {
                var next = edge * ratio;
                var from = Math.Max(1, (int)(edge / binHz));
                var to = Math.Max(from + 1, (int)(next / binHz));
                to = Math.Min(to, FftSize / 2);

                var peak = 0.0;
                for (var i = from; i < to; i++)
                {
                    var magnitude = Math.Sqrt(_fft[i].X * _fft[i].X + _fft[i].Y * _fft[i].Y);
                    if (magnitude > peak) peak = magnitude;
                }

                // dB, then mapped onto 0..1 across the useful range. Linear
                // magnitude would leave every bar flat on the floor.
                var db = 20.0 * Math.Log10(peak + 1e-9);
                var value = (float)Math.Clamp((db - Floor) / -Floor, 0.0, 1.0);

                // A little extra lift at the top, where music carries less energy
                // but the ear still expects to see movement.
                value *= 1f + b / (float)Bands * 0.6f;
                value = Math.Clamp(value, 0f, 1f);

                _bands[b] = value > _bands[b]
                    ? _bands[b] + (value - _bands[b]) * Attack
                    : _bands[b] + (value - _bands[b]) * Decay;

                edge = next;
            }
        }
    }

    public void Dispose()
    {
        try
        {
            _capture?.StopRecording();
            _capture?.Dispose();
        }
        catch
        {
            // Shutting down; a device that already went away is not news.
        }
    }
}

/// <summary>
/// A handful of routes over a raw socket. Still deliberately small, but no longer
/// read-only: /audio, /nowplaying and /board accept a POST, because moving the
/// sound between headphones and speakers — or skipping a track, or keeping the
/// wall above the taskbar — is a thing only this machine can do and the board is
/// the place it is asked for.
///
/// The three things that keeps honest:
///   • A body is read on THREE routes, capped at 4 KB, and parsed as JSON or refused.
///   • A POST carrying an Origin that is not on the allowlist is refused before
///     anything is touched. CORS alone does not protect a mutation: the browser
///     enforces it on the RESPONSE, by which time the write has happened.
///
/// Everything else is unchanged: GET, allowlisted origins, loopback only.
/// </summary>
internal sealed class HttpServer
{
    /// <summary>Every body this accepts is one or two fields long; 4 KB is generous.</summary>
    private const int MaxBody = 4096;

    private readonly int _port;
    private readonly IReadOnlyList<string> _origins;
    private readonly MediaWatcher _media;
    private readonly LevelMeter _levels;
    private readonly Vitals _vitals;
    private readonly Voicemeeter _audio;
    private readonly Processes _procs;
    private readonly Claude _claude;
    private readonly ClaudeSessions _sessions;
    private readonly Board _board;

    public HttpServer(
        int port, IReadOnlyList<string> origins, MediaWatcher media, LevelMeter levels, Vitals vitals,
        Voicemeeter audio, Processes procs, Claude claude, ClaudeSessions sessions, Board board)
    {
        _port = port;
        _origins = origins;
        _media = media;
        _levels = levels;
        _vitals = vitals;
        _audio = audio;
        _procs = procs;
        _claude = claude;
        _sessions = sessions;
        _board = board;
    }

    public async Task RunAsync(CancellationToken cancel)
    {
        var listener = new TcpListener(IPAddress.Loopback, _port);
        listener.Start();
        while (!cancel.IsCancellationRequested)
        {
            var client = await listener.AcceptTcpClientAsync(cancel);
            _ = HandleAsync(client, cancel);
        }
    }

    private async Task HandleAsync(TcpClient client, CancellationToken cancel)
    {
        try
        {
            using (client)
            {
                client.NoDelay = true;
                using var stream = client.GetStream();
                var request = await ReadRequestAsync(stream, cancel);
                if (request is null) return;

                var (method, path, origin, body) = request.Value;
                var allowed = origin is not null && _origins.Contains(origin.TrimEnd('/'));
                var cors = allowed ? origin! : _origins[0];
                var route = path.Split('?')[0];

                if (method == "OPTIONS")
                {
                    await WriteHeadAsync(stream, 204, null, cors, 0, null, cancel);
                    return;
                }
                if (method == "POST")
                {
                    // Three mutating routes, and only for a page we shipped. An
                    // Origin from anywhere else is refused here, before the mixer
                    // or the player is touched — see the class docblock.
                    //
                    // /board is the odd one: its caller is the Next server, not a
                    // browser, so it arrives with NO Origin header at all. That
                    // passes the check below unchanged and deliberately — the
                    // rule has always been "a wrong Origin is refused", and a
                    // local process that could send this could equally send
                    // anything else to a loopback socket.
                    if (route is not ("/audio" or "/nowplaying" or "/board"))
                    {
                        await WriteTextAsync(stream, 405, "method not allowed", cors, cancel);
                        return;
                    }
                    if (origin is not null && !allowed)
                    {
                        await WriteTextAsync(stream, 403, "origin not allowed", cors, cancel);
                        return;
                    }
                    if (body is null)
                    {
                        await WriteTextAsync(stream, 413, "body too large", cors, cancel);
                        return;
                    }
                    if (route == "/audio") await WriteAudioAsync(stream, body, cors, cancel);
                    else if (route == "/board") await WriteBoardAsync(stream, body, cors, cancel);
                    else await WriteTransportAsync(stream, body, cors, cancel);
                    return;
                }
                if (method != "GET")
                {
                    await WriteTextAsync(stream, 405, "method not allowed", cors, cancel);
                    return;
                }

                switch (route)
                {
                    case "/" or "/health":
                        await WriteTextAsync(stream, 200, "dayboard-nowplaying ok", cors, cancel);
                        break;
                    case "/nowplaying":
                        await WriteBodyAsync(stream, 200, "application/json; charset=utf-8",
                            Encoding.UTF8.GetBytes(MediaWatcher.ToJson(_media.Current)), cors, "no-store", cancel);
                        break;
                    case "/art":
                        await ServeArtAsync(stream, cors, cancel);
                        break;
                    case "/vitals":
                        // Polled, not streamed. /events runs at 33ms for the EQ
                        // and these move at 1Hz; more to the point the vitals
                        // widget sits in a hidden panel tab most of the time and
                        // has to STOP asking, which a fetch loop does for free
                        // and an EventSource does not.
                        // Processes are composed here rather than sampled inside
                        // Vitals: that class owns hardware sensors on a 1s tick and
                        // knows nothing about the process table. The mixer used to
                        // ride along here too — it moved to the player bar, which
                        // reads /audio directly, so this is hardware again.
                        await WriteJsonAsync(stream,
                            Vitals.ToJson(_vitals.Read() with { Processes = _procs.Read() }), cors, cancel);
                        break;
                    case "/audio":
                        await WriteJsonAsync(stream, Voicemeeter.ToJson(_audio.Read()), cors, cancel);
                        break;
                    case "/board":
                        // Whether the board is being kept on top, and whether
                        // there is a second monitor to keep. Read live rather than held —
                        // see Board.Read.
                        await WriteJsonAsync(stream, Board.ToJson(_board.Read()), cors, cancel);
                        break;
                    case "/claude":
                        // A HELD COPY, NOT A FRESH CALL. Every other GET here reads
                        // a sensor on demand; this one must not, because upstream is
                        // somebody else's rate-limited API. Claude does the asking on
                        // its own slow cadence and this hands back whatever it last
                        // heard, so the widget is free to poll as often as the board
                        // refreshes without any of it reaching Anthropic.
                        await WriteJsonAsync(stream, Claude.ToJson(_claude.Read()), cors, cancel);
                        break;
                    case "/claude/activity":
                        // Its own route rather than a field on /claude: the bars
                        // move every five minutes and the mascot every two
                        // seconds, and merging them would make the widget choose
                        // one polling rate for both. Cheap either way — this is a
                        // held copy too.
                        await WriteJsonAsync(
                            stream, ClaudeSessions.ToJson(_sessions.Read()), cors, cancel);
                        break;
                    case "/events":
                        await StreamEventsAsync(stream, cors, cancel);
                        break;
                    default:
                        await WriteTextAsync(stream, 404, "no such route", cors, cancel);
                        break;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or OperationCanceledException or SocketException)
        {
            // The browser closing a tab mid-stream is the normal way this ends.
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"http: {ex.Message}");
        }
    }

    /// <summary>
    /// The one write. Body is <c>{"output":"headphones"|"speakers"|"toggle"}</c>
    /// or <c>{"mute":"on"|"off"}</c>, and the response is the state afterwards,
    /// so the widget never needs a follow-up GET to find out whether it worked.
    ///
    /// `mute` is its own key rather than a third value of `output`, because it
    /// is not a choice of destination: output picks a room, mute silences
    /// whichever room was picked and remembers which it was.
    /// </summary>
    private async Task WriteAudioAsync(
        NetworkStream stream, string body, string cors, CancellationToken cancel)
    {
        if (!_audio.Available)
        {
            await WriteBodyAsync(stream, 503, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes(Voicemeeter.ToJson(AudioSnapshot.Down())), cors, "no-store", cancel);
            return;
        }

        string? output = null;
        string? mute = null;
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("output", out var o)) output = o.GetString();
            if (document.RootElement.TryGetProperty("mute", out var u)) mute = u.GetString();
        }
        catch (JsonException)
        {
            await WriteTextAsync(stream, 400, "bad json", cors, cancel);
            return;
        }

        AudioSnapshot result;
        switch (output, mute)
        {
            case ("headphones" or "speakers" or "toggle", null):
                result = _audio.SetOutput(output!);
                break;
            case (null, "on" or "off"):
                result = _audio.SetMute(mute == "on");
                break;
            default:
                await WriteTextAsync(stream, 400, "expected {output} or {mute}", cors, cancel);
                return;
        }

        await WriteJsonAsync(stream, Voicemeeter.ToJson(result), cors, cancel);
    }

    /// <summary>
    /// The other write. Body is <c>{"command":"play"|"pause"|"next"|"previous"}</c>.
    ///
    /// WHY THIS ANSWERS DIFFERENTLY FROM /audio, which replies with the new state:
    /// nothing else would tell the mixer widget whether its click landed, but this
    /// one has a live SSE feed sitting next to it. Publish compares Status, so a
    /// pause emits a `track` event by itself and the widget's icon flips from the
    /// same stream that draws everything else about the song. Replying with a
    /// snapshot here would race that feed and win half the time, which is how a
    /// button ends up flickering between two truths.
    ///
    /// "Nothing is playing" is a 200 with ok:false, not a 503. Voicemeeter being
    /// absent is a broken install; no music is Tuesday afternoon.
    /// </summary>
    private async Task WriteTransportAsync(
        NetworkStream stream, string body, string cors, CancellationToken cancel)
    {
        string? command = null;
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("command", out var c)) command = c.GetString();
        }
        catch (JsonException)
        {
            await WriteTextAsync(stream, 400, "bad json", cors, cancel);
            return;
        }

        if (command is not ("play" or "pause" or "next" or "previous"))
        {
            await WriteTextAsync(
                stream, 400, "expected {command: play|pause|next|previous}", cors, cancel);
            return;
        }

        var ok = await _media.ControlAsync(command);
        await WriteJsonAsync(stream, ok ? "{\"ok\":true}" : "{\"ok\":false}", cors, cancel);
    }

    /// <summary>
    /// The third write. Body is <c>{"pin":"on"|"off"|"toggle"}</c>.
    ///
    /// Answers with the state afterwards, following /audio rather than
    /// /nowplaying: there is no event stream carrying window state, so the only
    /// way the caller learns whether a toggle landed on "on" or "off" is this
    /// reply. "toggle" is resolved against live state in here for the same
    /// reason SetOutput resolves it there — a caller that has to read first and
    /// then write has a race with itself.
    /// </summary>
    private async Task WriteBoardAsync(
        NetworkStream stream, string body, string cors, CancellationToken cancel)
    {
        string? pin = null;
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("pin", out var p)) pin = p.GetString();
        }
        catch (JsonException)
        {
            await WriteTextAsync(stream, 400, "bad json", cors, cancel);
            return;
        }

        if (pin is not ("on" or "off" or "toggle"))
        {
            await WriteTextAsync(stream, 400, "expected {pin: on|off|toggle}", cors, cancel);
            return;
        }

        await WriteJsonAsync(stream, Board.ToJson(_board.Set(pin)), cors, cancel);
    }

    private static Task WriteJsonAsync(
        NetworkStream stream, string json, string cors, CancellationToken cancel)
        => WriteBodyAsync(stream, 200, "application/json; charset=utf-8",
            Encoding.UTF8.GetBytes(json), cors, "no-store", cancel);

    private async Task ServeArtAsync(NetworkStream stream, string cors, CancellationToken cancel)
    {
        var (bytes, type, version) = _media.Art;
        if (bytes.Length == 0)
        {
            await WriteTextAsync(stream, 404, "no art", cors, cancel);
            return;
        }
        // The URL carries the content hash, so this can never be wrongly cached.
        await WriteBodyAsync(stream, 200, type, bytes, cors, "public, max-age=31536000, immutable", cancel);
    }

    /// <summary>
    /// One SSE connection carries both rates: a "track" event whenever the song
    /// changes, and a "levels" frame ~30 times a second. Two rates down one pipe
    /// beats two connections, and beats polling at 30 Hz.
    /// </summary>
    private async Task StreamEventsAsync(NetworkStream stream, string cors, CancellationToken cancel)
    {
        await WriteHeadAsync(stream, 200, "text/event-stream; charset=utf-8", cors, -1, "no-store", cancel);

        var pending = MediaWatcher.ToJson(_media.Current);
        var dirty = true;
        void OnChanged(Snapshot s)
        {
            pending = MediaWatcher.ToJson(s);
            dirty = true;
        }

        _media.Changed += OnChanged;
        try
        {
            var buffer = new StringBuilder();
            while (!cancel.IsCancellationRequested)
            {
                buffer.Clear();
                if (dirty)
                {
                    dirty = false;
                    buffer.Append("event: track\ndata: ").Append(pending).Append("\n\n");
                }
                if (_levels.Available)
                {
                    buffer.Append("event: levels\ndata: [");
                    var bands = _levels.Read();
                    for (var i = 0; i < bands.Length; i++)
                    {
                        if (i > 0) buffer.Append(',');
                        buffer.Append(bands[i].ToString("0.###", CultureInfo.InvariantCulture));
                    }
                    buffer.Append("]\n\n");
                }

                if (buffer.Length > 0)
                {
                    var chunk = Encoding.UTF8.GetBytes(buffer.ToString());
                    await stream.WriteAsync(chunk, cancel);
                    await stream.FlushAsync(cancel);
                }

                await Task.Delay(33, cancel);
            }
        }
        finally
        {
            _media.Changed -= OnChanged;
        }
    }

    /// <summary>
    /// Headers, and — for the one route that takes one — the body after them.
    ///
    /// A null Body means the request declared more than <see cref="MaxBody"/>
    /// bytes and was not read; the caller answers 413. A request with no body at
    /// all gets the empty string, which is not the same thing.
    /// </summary>
    private static async Task<(string Method, string Path, string? Origin, string? Body)?> ReadRequestAsync(
        NetworkStream stream, CancellationToken cancel)
    {
        var buffer = new byte[8192];
        var read = 0;
        var headerEnd = -1;
        while (read < buffer.Length)
        {
            var got = await stream.ReadAsync(buffer.AsMemory(read, buffer.Length - read), cancel);
            if (got == 0) break;
            read += got;
            headerEnd = Encoding.ASCII.GetString(buffer, 0, read).IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (headerEnd >= 0) break;
        }
        if (read == 0) return null;

        var text = Encoding.ASCII.GetString(buffer, 0, read);
        var head = headerEnd >= 0 ? text[..headerEnd] : text;
        var lines = head.Split("\r\n");
        var start = lines[0].Split(' ');
        if (start.Length < 2) return null;

        string? origin = null;
        var length = 0;
        foreach (var line in lines)
        {
            if (line.StartsWith("Origin:", StringComparison.OrdinalIgnoreCase))
            {
                origin = line[7..].Trim();
            }
            else if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
            {
                _ = int.TryParse(line[15..].Trim(), CultureInfo.InvariantCulture, out length);
            }
        }

        if (length <= 0 || headerEnd < 0) return (start[0], start[1], origin, "");
        if (length > MaxBody) return (start[0], start[1], origin, null);

        // Whatever arrived in the same read as the headers, plus the rest.
        var bodyStart = headerEnd + 4;
        var body = new byte[length];
        var have = Math.Min(length, read - bodyStart);
        Array.Copy(buffer, bodyStart, body, 0, have);
        while (have < length)
        {
            var got = await stream.ReadAsync(body.AsMemory(have, length - have), cancel);
            if (got == 0) break;
            have += got;
        }
        return (start[0], start[1], origin, Encoding.UTF8.GetString(body, 0, have));
    }

    private static Task WriteTextAsync(NetworkStream stream, int status, string body, string cors, CancellationToken cancel)
        => WriteBodyAsync(stream, status, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(body), cors, "no-store", cancel);

    private static async Task WriteBodyAsync(
        NetworkStream stream, int status, string type, byte[] body, string cors, string? cache, CancellationToken cancel)
    {
        await WriteHeadAsync(stream, status, type, cors, body.Length, cache, cancel);
        await stream.WriteAsync(body, cancel);
        await stream.FlushAsync(cancel);
    }

    /// <param name="length">-1 for a stream that never ends.</param>
    private static async Task WriteHeadAsync(
        NetworkStream stream, int status, string? type, string cors, long length, string? cache, CancellationToken cancel)
    {
        var head = new StringBuilder();
        head.Append("HTTP/1.1 ").Append(status).Append(' ').Append(Reason(status)).Append("\r\n");
        if (type is not null) head.Append("Content-Type: ").Append(type).Append("\r\n");
        if (length >= 0) head.Append("Content-Length: ").Append(length).Append("\r\n");
        if (cache is not null) head.Append("Cache-Control: ").Append(cache).Append("\r\n");
        // Explicit origin, never "*": the allowlist is the only thing stopping a
        // random tab from reading this, and crossOrigin art needs a real value.
        head.Append("Access-Control-Allow-Origin: ").Append(cors).Append("\r\n");
        head.Append("Vary: Origin\r\n");
        head.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        // A JSON POST is not a "simple request", so the browser preflights it and
        // will not send the header unless we say we accept it. Without this line
        // the audio buttons fail in the browser while curl works fine.
        head.Append("Access-Control-Allow-Headers: content-type\r\n");
        // Chrome treats an HTTPS page reaching 127.0.0.1 as a private-network
        // request and preflights that separately. Harmless where it is not
        // enforced; the difference between working and not on an https board.
        head.Append("Access-Control-Allow-Private-Network: true\r\n");
        head.Append("Access-Control-Max-Age: 86400\r\n");
        head.Append("X-Content-Type-Options: nosniff\r\n");
        head.Append(length >= 0 ? "Connection: close\r\n" : "Connection: keep-alive\r\n");
        head.Append("\r\n");
        var bytes = Encoding.ASCII.GetBytes(head.ToString());
        await stream.WriteAsync(bytes, cancel);
    }

    private static string Reason(int status) => status switch
    {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Content Too Large",
        503 => "Service Unavailable",
        _ => "OK",
    };
}
