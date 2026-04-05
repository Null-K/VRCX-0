using NLog;
using NLog.Targets;
using System;
using System.Data.SQLite;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace VRCX_0
{
    public static class Program
    {
        public static string BaseDirectory { get; private set; }
        public static string AppDataDirectory;
        public static string ConfigLocation { get; private set; }
        public static string Version { get; private set; }
        public static bool LaunchDebug;
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();
        public static AppApi AppApiInstance { get; private set; }

        private static void SetProgramDirectories()
        {
            if (string.IsNullOrEmpty(AppDataDirectory))
                AppDataDirectory = Path.Join(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "VRCX-0");

            BaseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            ConfigLocation = Path.Join(AppDataDirectory, "VRCX-0.sqlite3");

            // One-time migration from old VRCX data directory
            MigrateFromOldVrcx();

            if (!Directory.Exists(AppDataDirectory))
            {
                Directory.CreateDirectory(AppDataDirectory);

                // Migrate config to AppData
                if (File.Exists(Path.Join(BaseDirectory, "VRCX-0.json")))
                {
                    File.Move(Path.Join(BaseDirectory, "VRCX-0.json"), Path.Join(AppDataDirectory, "VRCX-0.json"));
                    File.Copy(Path.Join(AppDataDirectory, "VRCX-0.json"),
                        Path.Join(AppDataDirectory, "VRCX-0-backup.json"));
                }

                if (File.Exists(Path.Join(BaseDirectory, "VRCX-0.sqlite3")))
                {
                    File.Move(Path.Join(BaseDirectory, "VRCX-0.sqlite3"),
                        Path.Join(AppDataDirectory, "VRCX-0.sqlite3"));
                    File.Copy(Path.Join(AppDataDirectory, "VRCX-0.sqlite3"),
                        Path.Join(AppDataDirectory, "VRCX-0-backup.sqlite3"));
                }
            }

            // Migrate cache to userdata for Cef 115 update
            var oldCachePath = Path.Join(AppDataDirectory, "cache");
            var newCachePath = Path.Join(AppDataDirectory, "userdata", "cache");
            if (Directory.Exists(oldCachePath) && !Directory.Exists(newCachePath))
            {
                Directory.CreateDirectory(Path.Join(AppDataDirectory, "userdata"));
                Directory.Move(oldCachePath, newCachePath);
            }
        }

        private static void MigrateFromOldVrcx()
        {
            if (Directory.Exists(AppDataDirectory))
                return;

            var oldAppData = Path.Join(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "VRCX");
            if (!Directory.Exists(oldAppData))
                return;

            var marker = Path.Join(oldAppData, ".migrated-to-vrcx-0");
            if (File.Exists(marker))
                return;

            try
            {
                Directory.CreateDirectory(AppDataDirectory);

                // Copy key data files with new names
                CopyIfExists(Path.Join(oldAppData, "VRCX.sqlite3"), Path.Join(AppDataDirectory, "VRCX-0.sqlite3"));
                CopyIfExists(Path.Join(oldAppData, "VRCX.json"), Path.Join(AppDataDirectory, "VRCX-0.json"));

                // Copy directories
                CopyDirectoryIfExists(Path.Join(oldAppData, "userdata"), Path.Join(AppDataDirectory, "userdata"));
                CopyDirectoryIfExists(Path.Join(oldAppData, "cache"), Path.Join(AppDataDirectory, "cache"));
                CopyDirectoryIfExists(Path.Join(oldAppData, "logs"), Path.Join(AppDataDirectory, "logs"));

                // Mark old directory as migrated
                File.WriteAllText(marker, $"Migrated to VRCX-0 on {DateTime.UtcNow:O}");
            }
            catch
            {
                // Migration is best-effort; don't block startup
            }
        }

        private static void CopyIfExists(string source, string destination)
        {
            if (File.Exists(source))
                File.Copy(source, destination, false);
        }

        private static void CopyDirectoryIfExists(string source, string destination)
        {
            if (!Directory.Exists(source))
                return;

            Directory.CreateDirectory(destination);
            foreach (var file in Directory.GetFiles(source))
            {
                File.Copy(file, Path.Join(destination, Path.GetFileName(file)), false);
            }

            foreach (var dir in Directory.GetDirectories(source))
            {
                CopyDirectoryIfExists(dir, Path.Join(destination, Path.GetFileName(dir)));
            }
        }

        private static void GetVersion()
        {
            try
            {
                var versionFile = File.ReadAllText(Path.Join(BaseDirectory, "Version")).Trim();

                // look for trailing git hash "-22bcd96" to indicate nightly build
                var version = versionFile.Split('-');
                if (version.Length > 0 && version[^1].Length == 7)
                    Version = $"VRCX-0 Nightly {versionFile}";
                else
                    Version = $"VRCX-0 {versionFile}";
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Failed to read version file");
                Version = "VRCX-0 Nightly Build";
            }
        }

        private static void MigrateStartupRegistry()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", true);
                if (key == null)
                    return;

                var oldStartup = key.GetValue("VRCX") as string;
                if (string.IsNullOrEmpty(oldStartup))
                    return;

                if (string.IsNullOrEmpty(key.GetValue("VRCX-0") as string))
                {
                    key.SetValue("VRCX-0", $"\"{Application.ExecutablePath}\" --startup");
                }

                key.DeleteValue("VRCX", false);
            }
            catch (Exception ex)
            {
                logger.Warn(ex, "Failed to migrate startup registry entry");
            }
        }

        private static void ConfigureLogger()
        {
            var fileName = Path.Join(AppDataDirectory, "logs", "VRCX-0.log");

            LogManager.Setup().LoadConfiguration(builder =>
            {
                var fileTarget = new FileTarget("fileTarget")
                {
                    FileName = fileName,
                    //Layout = "${longdate} [${level:uppercase=true}] ${logger} - ${message} ${exception:format=tostring}",
                    // Layout with padding between the level/logger and message so that the message always starts at the same column
                    Layout =
                        "${longdate} [${level:uppercase=true:padding=-5}] ${logger:padding=-20} - ${message} ${exception:format=tostring}",
                    ArchiveSuffixFormat = "{0:000}",
                    ArchiveEvery = FileArchivePeriod.Day,
                    MaxArchiveFiles = 4,
                    MaxArchiveDays = 7,
                    ArchiveAboveSize = 10000000,
                    ArchiveOldFileOnStartup = true,
                    KeepFileOpen = true,
                    AutoFlush = true,
                    Encoding = System.Text.Encoding.UTF8
                };
                builder.ForLogger().FilterMinLevel(LogLevel.Debug).WriteTo(fileTarget);

                var consoleTarget = new ConsoleTarget("consoleTarget")
                {
                    Layout = "${longdate} [${level:uppercase=true:padding=-5}] ${logger:padding=-20} - ${message} ${exception:format=tostring}",
                    DetectConsoleAvailable = true
                };
                builder.ForLogger().FilterMinLevel(LogLevel.Debug).WriteTo(consoleTarget);
            });
        }

        [STAThread]
        [SuppressMessage("Interoperability", "CA1416:Validate platform compatibility")]
        private static void Main()
        {
            try
            {
                Run();
            }

            #region Handle Database Error

            catch (SQLiteException e)
            {
                logger.Fatal(e, "Unhandled SQLite Exception, closing.");
                var messageBoxResult = MessageBox.Show(
                    "A fatal database error has occured.\n" +
                    "Please try to repair your database by following the steps in the provided repair guide, or alternatively rename your \"%AppData%\\VRCX-0\" folder to reset VRCX-0. " +
                    "If the issue still persists after following the repair guide please open an issue on GitHub (https://github.com/Map1en/VRCX-0/issues) for further assistance. " +
                    "Would you like to open the webpage for database repair steps?\n" +
                    e, "Database error", MessageBoxButtons.YesNo, MessageBoxIcon.Error);
                if (messageBoxResult == DialogResult.Yes)
                {
                    AppApiInstance.OpenLink("https://github.com/Map1en/VRCX-0/wiki#how-to-repair-vrcx-database");
                }
            }
            
            #endregion

            catch (Exception e)
            {
                var cpuError = WinApi.GetCpuErrorMessage();
                if (cpuError != null)
                {
                    var messageBoxResult = MessageBox.Show(cpuError.Value.Item1, "Potentially Faulty CPU Detected",
                        MessageBoxButtons.YesNo, MessageBoxIcon.Error);
                    if (messageBoxResult == DialogResult.Yes)
                    {
                        AppApiInstance.OpenLink(cpuError.Value.Item2);
                    }
                }

                logger.Fatal(e, "Unhandled Exception, program dying");
                var result = MessageBox.Show(e.ToString(), $"{Version} crashed, open GitHub for support?", MessageBoxButtons.YesNo, MessageBoxIcon.Error);
                if (result == DialogResult.Yes)
                {
                    AppApiInstance.OpenLink("https://github.com/Map1en/VRCX-0/issues");
                }
                Environment.Exit(0);
            }
        }

        [SuppressMessage("Interoperability", "CA1416:Validate platform compatibility")]
        private static void Run()
        {
            var args = Environment.GetCommandLineArgs();
            StartupArgs.ArgsCheck(args);
            SetProgramDirectories();
            VRCXStorage.Instance.Load();
            ConfigureLogger();
            GetVersion();
            MigrateStartupRegistry();

            Update.Check();

            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            logger.Info("{0} Starting...", Version);
            logger.Info("Args: {0}", JsonSerializer.Serialize(StartupArgs.Args));
            if (!string.IsNullOrEmpty(StartupArgs.LaunchArguments.LaunchCommand))
                logger.Info("Launch Command: {0}", StartupArgs.LaunchArguments.LaunchCommand);
            
            IPCServer.Instance.Init();
            SQLite.Instance.Init();
            AppApiInstance = new AppApiWebView2();
            
            ProcessMonitor.Instance.Init();
            Discord.Instance.Init();
            WebApi.Instance.Init();
            LogWatcher.Instance.Init();
            AutoAppLaunchManager.Instance.Init();
            try
            {
                WebView2Service.Instance.Init().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                logger.Error(ex, "Failed to initialize WebView2 environment");
                MessageBox.Show(
                    $"Failed to initialize WebView2.\nPlease ensure Microsoft Edge WebView2 Runtime is installed.\n\n{ex.Message}",
                    "VRCX-0 Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Environment.Exit(1);
                return;
            }

            Application.Run(new MainForm());

            logger.Info("{0} Exiting...", Version);
            WebApi.Instance.SaveCookies();
            WebView2Service.Instance.Exit();
            AutoAppLaunchManager.Instance.Exit();
            LogWatcher.Instance.Exit();
            WebApi.Instance.Exit();
            Discord.Instance.Exit();
            VRCXStorage.Instance.Save();
            SQLite.Instance.Exit();
            ProcessMonitor.Instance.Exit();
        }
    }
}
