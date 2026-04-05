using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Toolkit.Uwp.Notifications;
using Microsoft.Win32;
using NLog;

namespace VRCX_0
{
    public partial class AppApiWebView2 : AppApi
    {
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();

        public override void ShowDevTools()
        {
            MainForm.Instance.Browser?.CoreWebView2?.OpenDevToolsWindow();
        }

        public override void SetVR(bool active, bool hmdOverlay, bool wristOverlay, bool menuButton, int overlayHand)
        {
            // VR overlay removed in VRCX-0
        }

        public override void SetZoom(double zoomLevel)
        {
            if (MainForm.Instance.Browser?.CoreWebView2 == null)
                return;

            // CefSharp zoom level: zoomFactor = 1.2^zoomLevel
            // WebView2 uses ZoomFactor directly (1.0 = 100%)
            MainForm.Instance.Browser.ZoomFactor = Math.Pow(1.2, zoomLevel);
        }

        public override Task<double> GetZoom()
        {
            var zoomFactor = MainForm.Instance.Browser?.ZoomFactor ?? 1.0;
            // Convert back to CefSharp-style zoom level
            var zoomLevel = Math.Log(zoomFactor) / Math.Log(1.2);
            return Task.FromResult(zoomLevel);
        }

        public override void DesktopNotification(string BoldText, string Text = "", string Image = "")
        {
            try
            {
                ToastContentBuilder builder = new ToastContentBuilder();

                if (Uri.TryCreate(Image, UriKind.Absolute, out Uri uri))
                    builder.AddAppLogoOverride(uri);

                if (!string.IsNullOrEmpty(BoldText))
                    builder.AddText(BoldText);

                if (!string.IsNullOrEmpty(Text))
                    builder.AddText(Text);

                builder.Show();
            }
            catch (System.AccessViolationException ex)
            {
                logger.Warn(ex, "Unable to send desktop notification");
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Unknown error when sending desktop notification");
            }
        }

        public override void RestartApplication(bool isUpgrade)
        {
            var args = new List<string>();

            if (isUpgrade)
                args.Add(StartupArgs.VrcxLaunchArguments.IsUpgradePrefix);

            if (StartupArgs.LaunchArguments.IsDebug)
                args.Add(StartupArgs.VrcxLaunchArguments.IsDebugPrefix);

            if (!string.IsNullOrWhiteSpace(StartupArgs.LaunchArguments.ConfigDirectory))
                args.Add($"{StartupArgs.VrcxLaunchArguments.ConfigDirectoryPrefix}={StartupArgs.LaunchArguments.ConfigDirectory}");

            if (!string.IsNullOrWhiteSpace(StartupArgs.LaunchArguments.ProxyUrl))
                args.Add($"{StartupArgs.VrcxLaunchArguments.ProxyUrlPrefix}={StartupArgs.LaunchArguments.ProxyUrl}");

            var vrcxProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = Path.Join(Program.BaseDirectory, "VRCX-0.exe"),
                    Arguments = string.Join(' ', args),
                    UseShellExecute = true,
                    WorkingDirectory = Program.BaseDirectory
                }
            };
            vrcxProcess.Start();
            Environment.Exit(0);
        }

        public override bool CheckForUpdateExe()
        {
            return File.Exists(Path.Join(Program.AppDataDirectory, "update.exe"));
        }

        public override void ExecuteVrOverlayFunction(string function, string json)
        {
            // VR overlay removed in VRCX-0
        }

        public override void FocusWindow()
        {
            MainForm.Instance.Invoke(new Action(() => { MainForm.Instance.Focus_Window(); }));
        }

        public override void ChangeTheme(int value)
        {
            WinformThemer.SetGlobalTheme(value);
        }

        public override void DoFunny()
        {
            WinformThemer.DoFunny();
        }

        public override string GetClipboard()
        {
            var clipboard = string.Empty;
            var thread = new Thread(() => clipboard = Clipboard.GetText());
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            thread.Join();
            return clipboard;
        }

        public override void SetStartup(bool enabled)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", true);
                if (key == null)
                {
                    logger.Warn("Failed to open startup registry key");
                    return;
                }

                if (enabled)
                {
                    var path = Application.ExecutablePath;
                    key.SetValue("VRCX-0", $"\"{path}\" --startup");
                    key.DeleteValue("VRCX", false);
                }
                else
                {
                    key.DeleteValue("VRCX-0", false);
                    key.DeleteValue("VRCX", false);
                }
            }
            catch (Exception e)
            {
                logger.Warn(e, "Failed to set startup");
            }
        }

        public override void CopyImageToClipboard(string path)
        {
            if (!File.Exists(path) ||
                (!path.EndsWith(".png") &&
                 !path.EndsWith(".jpg") &&
                 !path.EndsWith(".jpeg") &&
                 !path.EndsWith(".gif") &&
                 !path.EndsWith(".bmp") &&
                 !path.EndsWith(".webp")))
                return;

            MainForm.Instance.BeginInvoke(new MethodInvoker(() =>
            {
                var image = Image.FromFile(path);
                var data = new DataObject();
                data.SetData(DataFormats.Bitmap, image);
                data.SetFileDropList(new StringCollection { path });
                Clipboard.SetDataObject(data, true);
            }));
        }

        public override void FlashWindow()
        {
            MainForm.Instance.BeginInvoke(new MethodInvoker(() => { WinformThemer.Flash(MainForm.Instance); }));
        }

        public override void SetUserAgent()
        {
            if (MainForm.Instance.Browser?.CoreWebView2 != null)
                MainForm.Instance.Browser.CoreWebView2.Settings.UserAgent = Program.Version;
        }

        public override void SetTrayIconNotification(bool notify)
        {
            MainForm.Instance.BeginInvoke(new MethodInvoker(() => { MainForm.Instance.SetTrayIconNotification(notify); }));
        }

        public override void OpenCalendarFile(string icsContent)
        {
            if (!icsContent.StartsWith("BEGIN:VCALENDAR") ||
                !icsContent.EndsWith("END:VCALENDAR"))
                throw new Exception("Invalid calendar file");

            try
            {
                var tempPath = Path.Combine(Program.AppDataDirectory, "event.ics");
                File.WriteAllText(tempPath, icsContent);
                Process.Start(new ProcessStartInfo
                {
                    FileName = tempPath,
                    UseShellExecute = true
                })?.Dispose();
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Failed to open calendar file");
            }
        }
    }
}
