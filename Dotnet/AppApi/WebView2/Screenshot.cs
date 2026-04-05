using System;
using System.IO;
using System.Threading;

namespace VRCX_0
{
    public partial class AppApiWebView2
    {
        public override string AddScreenshotMetadata(string path, string metadataString, string worldId, bool changeFilename = false)
        {
            var fileName = Path.GetFileNameWithoutExtension(path);
            if (!File.Exists(path) || !path.EndsWith(".png") || !fileName.StartsWith("VRChat_"))
                return string.Empty;

            var success = false;
            for (var i = 0; i < 10; i++)
            {
                try
                {
                    using (File.Open(path, FileMode.Append, FileAccess.Write, FileShare.None))
                    {
                        success = true;
                        break;
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    Thread.Sleep(1000);
                }
            }
            if (!success)
                return string.Empty;

            if (changeFilename)
            {
                var newFileName = $"{fileName}_{worldId}";
                var newPath = Path.Join(Path.GetDirectoryName(path), newFileName + Path.GetExtension(path));
                File.Move(path, newPath);
                path = newPath;
            }

            ScreenshotHelper.WriteVRCXMetadata(metadataString, path);

            return path;
        }
    }
}
