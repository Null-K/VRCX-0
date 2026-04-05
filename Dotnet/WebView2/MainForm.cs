using System;
using System.Diagnostics.CodeAnalysis;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using NLog;

namespace VRCX_0
{
    [SuppressMessage("Interoperability", "CA1416:Validate platform compatibility")]
    public partial class MainForm : WinformBase
    {
        public static MainForm Instance;
        public static NativeWindow nativeWindow;
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();
        public WebView2 Browser;
        public MessageRouter Router { get; private set; }
        private readonly Icon _appIcon;
        private readonly Icon _appIconNoty;
        private readonly Timer _saveTimer;
        private int LastLocationX;
        private int LastLocationY;
        private int LastSizeWidth;
        private int LastSizeHeight;
        private FormWindowState LastWindowStateToRestore = FormWindowState.Normal;

        public MainForm()
        {
            Instance = this;
            InitializeComponent();
            nativeWindow = NativeWindow.FromHandle(this.Handle);

            _saveTimer = new Timer();
            _saveTimer.Interval = 5000;
            _saveTimer.Tick += SaveTimer_Tick;

            try
            {
                var path = Path.GetDirectoryName(Environment.ProcessPath) ?? string.Empty;
                _appIcon = new Icon(Path.Combine(path, "VRCX-0.ico"));
                _appIconNoty = new Icon(Path.Combine(path, "VRCX-0_notify.ico"));
                Icon = _appIcon;
                TrayIcon.Icon = _appIcon;
            }
            catch (Exception ex)
            {
                logger.Error(ex);
            }

            Browser = new WebView2
            {
                Dock = DockStyle.Fill
            };
            Controls.Add(Browser);

            Browser.CoreWebView2InitializationCompleted += Browser_CoreWebView2InitializationCompleted;
        }

        public async void InitWebView()
        {
            try
            {
                await Browser.EnsureCoreWebView2Async(WebView2Service.Instance.Environment);

                var coreWebView = Browser.CoreWebView2;

                // Map virtual host to local html folder
                var htmlFolder = Path.Combine(Program.BaseDirectory, "html");
                coreWebView.SetVirtualHostNameToFolderMapping(
                    "vrcx-0.local",
                    htmlFolder,
                    CoreWebView2HostResourceAccessKind.Allow);

                // Set up message router
                Router = new MessageRouter();
                Router.SetWebView(coreWebView);
                Router.Register("AppApi", Program.AppApiInstance);
                Router.Register("WebApi", WebApi.Instance);
                Router.Register("VRCXStorage", VRCXStorage.Instance);
                Router.Register("SQLite", SQLite.Instance);
                Router.Register("LogWatcher", LogWatcher.Instance);
                Router.Register("Discord", Discord.Instance);
                Router.Register("AssetBundleManager", AssetBundleManager.Instance);
                coreWebView.WebMessageReceived += Router.OnWebMessageReceived;

                // Settings
                var settings = coreWebView.Settings;
                settings.AreDefaultContextMenusEnabled = Program.LaunchDebug;
                settings.IsStatusBarEnabled = false;
                settings.IsZoomControlEnabled = false;
                settings.AreBrowserAcceleratorKeysEnabled = Program.LaunchDebug;

                // User agent
                settings.UserAgent = Program.Version;

                // Navigation filter — only allow our virtual host and dev server
                coreWebView.NavigationStarting += (_, args) =>
                {
                    var uri = args.Uri;
                    if (uri.StartsWith("https://vrcx-0.local/") ||
                        uri.StartsWith("http://localhost:9000/") ||
                        uri.StartsWith("devtools://") ||
                        uri.StartsWith("about:"))
                        return;

                    args.Cancel = true;
                    logger.Warn("Blocked navigation to: {0}", uri);
                };

                // New window requests — block and open externally
                coreWebView.NewWindowRequested += (_, args) =>
                {
                    args.Handled = true;
                    if (args.Uri.StartsWith("http://") || args.Uri.StartsWith("https://"))
                    {
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(args.Uri)
                        {
                            UseShellExecute = true
                        });
                    }
                };

                // Download handler — use default download behavior
                coreWebView.DownloadStarting += (_, args) =>
                {
                    // Allow downloads with default handling
                };

                // Console messages for logging
                coreWebView.WebMessageReceived += (_, args) =>
                {
                    // Additional logging handled by Router
                };

                // Focus handler
                Browser.GotFocus += (_, _) =>
                {
                    if (Browser.CoreWebView2 != null)
                    {
                        Router?.SendEvent("browserFocus");
                    }
                };

                // Navigate to app
                var url = Program.LaunchDebug
                    ? "http://localhost:9000/index.html"
                    : "https://vrcx-0.local/index.html";

                coreWebView.Navigate(url);

                if (Program.LaunchDebug)
                    coreWebView.OpenDevToolsWindow();

                logger.Info("WebView2 initialized, navigating to {0}", url);
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Failed to initialize WebView2");
                MessageBox.Show(
                    $"Failed to initialize WebView2.\nPlease ensure Microsoft Edge WebView2 Runtime is installed.\n\n{ex.Message}",
                    "VRCX-0 Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Environment.Exit(1);
            }
        }

        private void Browser_CoreWebView2InitializationCompleted(object sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                logger.Error(e.InitializationException, "WebView2 initialization failed");
            }
        }

        public void SetTrayIconNotification(bool notify)
        {
            TrayIcon.Icon = notify ? _appIconNoty : _appIcon;
        }

        public void Focus_Window()
        {
            Show();
            if (WindowState == FormWindowState.Minimized)
                WindowState = LastWindowStateToRestore;
            Activate();
        }

        private void MainForm_Load(object sender, EventArgs e)
        {
            try
            {
                int.TryParse(VRCXStorage.Instance.Get("VRCX-0_LocationX"), out LastLocationX);
                int.TryParse(VRCXStorage.Instance.Get("VRCX-0_LocationY"), out LastLocationY);
                int.TryParse(VRCXStorage.Instance.Get("VRCX-0_SizeWidth"), out LastSizeWidth);
                int.TryParse(VRCXStorage.Instance.Get("VRCX-0_SizeHeight"), out LastSizeHeight);
                var location = new Point(LastLocationX, LastLocationY);
                var size = new Size(LastSizeWidth, LastSizeHeight);
                var screen = Screen.FromPoint(location);
                if (screen.Bounds.Contains(location.X, location.Y))
                {
                    Location = location;
                }
                Size = new Size(1920, 1080);
                if (size.Width > 0 && size.Height > 0)
                {
                    Size = size;
                }
            }
            catch (Exception ex)
            {
                logger.Error(ex);
            }

            try
            {
                var state = WindowState;
                var startAsMinimized = VRCXStorage.Instance.Get("VRCX-0_StartAsMinimizedState") == "true";
                var closeToTray = VRCXStorage.Instance.Get("VRCX-0_CloseToTray") == "true";
                if (int.TryParse(VRCXStorage.Instance.Get("VRCX-0_WindowState"), out var value))
                {
                    state = (FormWindowState)value;
                }
                if (state == FormWindowState.Minimized)
                {
                    state = FormWindowState.Normal;
                }
                WindowState = state;
                LastWindowStateToRestore = state;

                if (StartupArgs.LaunchArguments.IsStartup && startAsMinimized)
                {
                    if (closeToTray)
                    {
                        BeginInvoke(Hide);
                    }
                    else
                    {
                        state = FormWindowState.Minimized;
                        WindowState = state;
                    }
                }
            }
            catch (Exception ex)
            {
                logger.Error(ex);
            }

            InitWebView();
        }

        private void MainForm_Resize(object sender, EventArgs e)
        {
            if (WindowState != FormWindowState.Minimized)
                LastWindowStateToRestore = WindowState;

            if (WindowState != FormWindowState.Normal)
                return;

            LastSizeWidth = Size.Width;
            LastSizeHeight = Size.Height;

            _saveTimer?.Start();
        }

        private void SaveTimer_Tick(object sender, EventArgs e)
        {
            SaveWindowState();
            _saveTimer?.Stop();
        }

        private void MainForm_Move(object sender, EventArgs e)
        {
            if (WindowState != FormWindowState.Normal)
                return;

            LastLocationX = Location.X;
            LastLocationY = Location.Y;

            _saveTimer?.Start();
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing &&
                "true".Equals(VRCXStorage.Instance.Get("VRCX-0_CloseToTray")))
            {
                e.Cancel = true;
                Hide();
            }
        }

        private void SaveWindowState()
        {
            VRCXStorage.Instance.Set("VRCX-0_LocationX", LastLocationX.ToString());
            VRCXStorage.Instance.Set("VRCX-0_LocationY", LastLocationY.ToString());
            VRCXStorage.Instance.Set("VRCX-0_SizeWidth", LastSizeWidth.ToString());
            VRCXStorage.Instance.Set("VRCX-0_SizeHeight", LastSizeHeight.ToString());
            VRCXStorage.Instance.Set("VRCX-0_WindowState", ((int)LastWindowStateToRestore).ToString());
            VRCXStorage.Instance.Save();
        }

        private void MainForm_FormClosed(object sender, FormClosedEventArgs e)
        {
            SaveWindowState();
        }

        private void TrayMenu_Open_Click(object sender, EventArgs e)
        {
            Focus_Window();
        }

        private void TrayMenu_DevTools_Click(object sender, EventArgs e)
        {
            Browser?.CoreWebView2?.OpenDevToolsWindow();
        }

        private void TrayMenu_ForceCrash_Click(object sender, EventArgs e)
        {
            throw new Exception("Force crash triggered from tray menu");
        }

        private void TrayMenu_Quit_Click(object sender, EventArgs e)
        {
            TrayIcon.Visible = false;
            Application.Exit();
        }

        private void TrayIcon_MouseClick(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                Focus_Window();
            }
        }
    }
}
