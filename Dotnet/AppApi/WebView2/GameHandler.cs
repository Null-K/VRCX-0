using System.Diagnostics;
using Microsoft.Win32;

namespace VRCX_0
{
    public partial class AppApiWebView2
    {
        public override void OnProcessStateChanged(MonitoredProcess monitoredProcess)
        {
            if (!monitoredProcess.HasName("VRChat") && !monitoredProcess.HasName("vrserver"))
                return;

            CheckGameRunning();
        }

        public override void CheckGameRunning()
        {
            var isGameRunning = ProcessMonitor.Instance.IsProcessRunning("VRChat");
            var isSteamVRRunning = ProcessMonitor.Instance.IsProcessRunning("vrserver");

            MainForm.Instance?.Router?.SendEvent("updateIsGameRunning", new { isGameRunning, isSteamVRRunning });
        }

        public override bool IsGameRunning()
        {
            return ProcessMonitor.Instance.IsProcessRunning("VRChat");
        }

        public override bool IsSteamVRRunning()
        {
            return ProcessMonitor.Instance.IsProcessRunning("vrserver");
        }

        public override int QuitGame()
        {
            var processes = Process.GetProcessesByName("VRChat");
            if (processes.Length == 1)
                processes[0].Kill();
            foreach (var process in processes)
                process.Dispose();

            return processes.Length;
        }

        public override bool StartGame(string arguments)
        {
            try
            {
                using var key = Registry.ClassesRoot.OpenSubKey(@"steam\shell\open\command");
                var match = System.Text.RegularExpressions.Regex.Match(key.GetValue(string.Empty) as string, "^\"(.+?)\\\\steam.exe\"");
                if (match.Success)
                {
                    var path = match.Groups[1].Value;
                    Process.Start(new ProcessStartInfo
                    {
                        WorkingDirectory = path,
                        FileName = $"{path}\\steam.exe",
                        UseShellExecute = false,
                        Arguments = $"-applaunch 438100 {arguments}"
                    })?.Dispose();
                    return true;
                }
            }
            catch
            {
                logger.Warn("Failed to start VRChat from Steam");
            }

            try
            {
                using var key = Registry.ClassesRoot.OpenSubKey(@"VRChat\shell\open\command");
                var match = System.Text.RegularExpressions.Regex.Match(key.GetValue(string.Empty) as string, "(?!\")(.+?\\\\VRChat.*)(!?\\\\launch.exe\")");
                if (match.Success)
                {
                    var path = match.Groups[1].Value;
                    return StartGameFromPath(path, arguments);
                }
            }
            catch
            {
                logger.Warn("Failed to start VRChat from registry");
            }

            return false;
        }

        public override bool StartGameFromPath(string path, string arguments)
        {
            if (!path.EndsWith(".exe"))
                path = System.IO.Path.Join(path, "launch.exe");

            if (!path.EndsWith("launch.exe") || !System.IO.File.Exists(path))
                return false;

            Process.Start(new ProcessStartInfo
            {
                WorkingDirectory = System.IO.Path.GetDirectoryName(path),
                FileName = path,
                UseShellExecute = false,
                Arguments = arguments
            })?.Dispose();
            return true;
        }
    }
}
