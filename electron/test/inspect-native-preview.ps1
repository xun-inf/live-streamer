param([Parameter(Mandatory = $true)][string]$OwnerHandle)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class NativePreviewProbe
{
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    public sealed class View
    {
        public string Handle, Owner, ProcessName;
        public uint ProcessId;
        public bool Visible;
        public int ZOrder;
        public Rect Bounds;
    }
    public sealed class Snapshot
    {
        public string Owner;
        public bool OwnerVisible;
        public Point ClientOrigin;
        public List<View> Views = new List<View>();
        public List<View> Overlays = new List<View>();
    }
    private delegate bool EnumCallback(IntPtr hwnd, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static Snapshot Read(long handle)
    {
        // Match Electron/media-service physical coordinates even on scaled displays.
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            IntPtr owner = new IntPtr(handle);
            if (!IsWindow(owner)) throw new InvalidOperationException("Main HWND no longer exists");
            Point origin = new Point();
            if (!ClientToScreen(owner, ref origin)) throw new Win32Exception(Marshal.GetLastWin32Error());
            Snapshot snapshot = new Snapshot { Owner = handle.ToString(), OwnerVisible = IsWindowVisible(owner), ClientOrigin = origin };
            int zOrder = 0;
            EnumWindows(delegate(IntPtr hwnd, IntPtr unused)
            {
                int index = zOrder++;
                StringBuilder name = new StringBuilder(256);
                GetClassName(hwnd, name, name.Capacity);
                StringBuilder title = new StringBuilder(256);
                GetWindowText(hwnd, title, title.Capacity);
                bool native = name.ToString() == "NativeWindowView";
                if ((!native && title.ToString() != "NativeBrowserView") || GetWindow(hwnd, 4) != owner) return true;
                uint processId;
                GetWindowThreadProcessId(hwnd, out processId);
                Rect bounds;
                if (!GetWindowRect(hwnd, out bounds)) throw new Win32Exception(Marshal.GetLastWin32Error());
                using (Process process = Process.GetProcessById((int)processId))
                {
                    (native ? snapshot.Views : snapshot.Overlays).Add(new View {
                        Handle = hwnd.ToInt64().ToString(), Owner = GetWindow(hwnd, 4).ToInt64().ToString(),
                        ProcessId = processId, ProcessName = process.ProcessName,
                        Visible = IsWindowVisible(hwnd), Bounds = bounds, ZOrder = index
                    });
                }
                return true;
            }, IntPtr.Zero);
            return snapshot;
        }
        finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@

[NativePreviewProbe]::Read([long]$OwnerHandle) | ConvertTo-Json -Depth 5 -Compress
