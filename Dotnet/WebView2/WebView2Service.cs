using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using NLog;

namespace VRCX_0
{
    public class WebView2Service
    {
        private static readonly Logger logger = LogManager.GetCurrentClassLogger();
        public static WebView2Service Instance { get; } = new();
        public CoreWebView2Environment Environment { get; private set; }

        public async Task Init()
        {
            var userDataFolder = Path.Join(Program.AppDataDirectory, "userdata");
            Directory.CreateDirectory(userDataFolder);

            var options = new CoreWebView2EnvironmentOptions();

            if (!string.IsNullOrEmpty(WebApi.ProxyUrl))
                options.AdditionalBrowserArguments += $" --proxy-server={WebApi.ProxyUrl}";

            if (Program.LaunchDebug)
                options.AdditionalBrowserArguments += " --remote-debugging-port=8089";

            Environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: userDataFolder,
                options: options
            );

            logger.Info("WebView2 environment initialized. UserDataFolder: {0}", userDataFolder);
        }

        public void Exit()
        {
        }
    }
}
