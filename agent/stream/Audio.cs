using System.Runtime.InteropServices;

namespace Dayboard.Stream;

/// <summary>
/// Mutes the stream browser at the Windows audio-session level — the same
/// switch as its row in the volume mixer.
///
/// WHY NOT THE PAGE. Muting the site's &lt;video&gt; was the first version, and
/// Apple TV's player answers a mute by setting its own volume to zero. Unmuting
/// the element then leaves a video that is "unmuted" at volume zero: the match
/// came back from the corner silent. Any site is free to do something like that
/// with its own player, and none of them can touch a session mute. It also
/// leaves the site's own volume slider exactly where you put it.
///
/// Chrome plays audio from its audio-service utility process, a child of the
/// browser process, so a session belongs to the stream browser if its process
/// is the browser or any descendant of it. The board's own Chrome is a separate
/// process tree and is never touched.
/// </summary>
internal static class Audio
{
    /// <summary>Mutes or unmutes every session of the process tree. Returns how many it found.</summary>
    public static int SetMuted(uint rootPid, bool mute)
    {
        if (rootPid == 0) return 0;
        var tree = Descendants(rootPid);
        var count = 0;
        var empty = Guid.Empty;

        try
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            if (enumerator.EnumAudioEndpoints(EDataFlowRender, DeviceStateActive, out var devices) != 0) return 0;
            devices.GetCount(out var deviceCount);

            for (uint d = 0; d < deviceCount; d++)
            {
                if (devices.Item(d, out var device) != 0) continue;
                var iid = typeof(IAudioSessionManager2).GUID;
                if (device.Activate(ref iid, ClsctxAll, IntPtr.Zero, out var managerObject) != 0) continue;
                var manager = (IAudioSessionManager2)managerObject;
                if (manager.GetSessionEnumerator(out var sessions) != 0) continue;
                sessions.GetCount(out var sessionCount);

                for (var s = 0; s < sessionCount; s++)
                {
                    if (sessions.GetSession(s, out var sessionObject) != 0) continue;
                    if (sessionObject is not IAudioSessionControl2 control) continue;
                    control.GetProcessId(out var pid);
                    if (pid == 0 || !tree.Contains(pid)) continue;
                    if (sessionObject is not ISimpleAudioVolume volume) continue;
                    volume.GetMute(out var already);
                    if (already != mute) volume.SetMute(mute, ref empty);
                    count++;
                }
            }
        }
        catch (COMException)
        {
            // No audio devices, or the audio service restarting. Next tick.
        }
        catch (InvalidCastException)
        {
        }
        return count;
    }

    /// <summary>The root and everything it started, from one process snapshot.</summary>
    private static HashSet<uint> Descendants(uint root)
    {
        var children = new Dictionary<uint, List<uint>>();
        var snapshot = CreateToolhelp32Snapshot(Th32csSnapProcess, 0);
        if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1)) return new HashSet<uint> { root };
        try
        {
            var entry = new ProcessEntry32 { Size = (uint)Marshal.SizeOf<ProcessEntry32>() };
            if (Process32FirstW(snapshot, ref entry))
            {
                do
                {
                    if (!children.TryGetValue(entry.ParentProcessId, out var list))
                    {
                        children[entry.ParentProcessId] = list = new List<uint>();
                    }
                    list.Add(entry.ProcessId);
                } while (Process32NextW(snapshot, ref entry));
            }
        }
        finally
        {
            CloseHandle(snapshot);
        }

        var found = new HashSet<uint> { root };
        var queue = new Queue<uint>();
        queue.Enqueue(root);
        while (queue.Count > 0)
        {
            if (!children.TryGetValue(queue.Dequeue(), out var list)) continue;
            foreach (var child in list)
            {
                if (found.Add(child)) queue.Enqueue(child);
            }
        }
        return found;
    }

    /* ------------------------------------------------------------ interop -- */

    private const int EDataFlowRender = 0;
    private const int DeviceStateActive = 1;
    private const int ClsctxAll = 23;
    private const uint Th32csSnapProcess = 0x00000002;

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorCom
    {
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig]
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
            [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        // IAudioSessionControl, in vtable order.
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr eventContext);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr eventContext);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(IntPtr grouping, IntPtr eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        // IAudioSessionControl2.
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out uint pid);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int PriClassBase;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry32 entry);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
