using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

/// <summary>
/// 双击入口。真正的 Electron 程序在 app\TXTReader.exe，
/// 在 Windows 11 25H2 上必须以 --no-sandbox 启动，而裸双击无法传参，
/// 所以由这个极小的 .NET 启动器带上参数再拉起它。
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main(string[] rawArgs)
    {
        string selfDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string appDir = Path.Combine(selfDir, "app");
        string appExe = Path.Combine(appDir, "TXTReader.exe");
        string dataDir = Path.Combine(selfDir, "data");

        if (!File.Exists(appExe))
        {
            System.Windows.Forms.MessageBox.Show(
                "找不到 app\\TXTReader.exe，请确认整个文件夹完整解压。",
                "TXT 阅读器");
            return;
        }

        try
        {
            Directory.CreateDirectory(dataDir);
        }
        catch
        {
            // 目录建不了就交给主程序自己决定，别在这里挡路
        }

        StringBuilder args = new StringBuilder();
        args.Append("--no-sandbox");
        args.Append(" --user-data-dir=\"").Append(dataDir).Append('"');
        foreach (string arg in rawArgs)
        {
            args.Append(' ').Append(arg);
        }

        ProcessStartInfo startInfo = new ProcessStartInfo(appExe, args.ToString());
        startInfo.WorkingDirectory = appDir;
        startInfo.UseShellExecute = false;
        Process.Start(startInfo);
    }
}
