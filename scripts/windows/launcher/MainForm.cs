using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

namespace Mirrai.Launcher;

/// <summary>
/// A small window that starts Mirrai and shows what is happening while it
/// comes up. The first launch initialises a database, which takes a while, so
/// without this the user would have no idea whether anything was happening.
/// </summary>
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private readonly string _appDir;
    private readonly Label _status = new();
    private readonly Label _detail = new();
    private readonly ProgressBar _progress = new();
    private readonly TextBox _log = new();
    private readonly Button _openBrowser = new();
    private readonly Button _stop = new();

    private Process? _process;
    private bool _ready;
    private bool _closing;
    /// <summary>True only when the user chose 退出 — a window close goes to the tray.</summary>
    private bool _reallyExit;

    // ─── The tray and the shortcut (C8.8) ──────────────────────────────
    //
    // The window used to be the whole app: closing it stopped Mirrai.
    // Now closing it puts the launcher in the notification area and the
    // server keeps running; the menu there has open / logs / quit, and
    // Ctrl+Alt+M brings the browser back from anywhere.
    private readonly NotifyIcon _trayIcon = new();
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_OPEN = 1;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    /// <summary>Where the start script's output is kept for "看日志".</summary>
    private string LogPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Mirrai", "logs", "launcher.log");

    private void WriteLogLine(string line)
    {
        try
        {
            var dir = Path.GetDirectoryName(LogPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.AppendAllText(LogPath, line.TrimEnd() + Environment.NewLine, Encoding.UTF8);
        }
        catch
        {
            // The log is a convenience; the window still shows everything.
        }
    }

    // The start script announces each stage; the first match wins.
    private static readonly (string Marker, int Percent, string Status)[] Stages =
    {
        ("Mirrai is starting", 5, "正在启动 Mirrai…"),
        ("Initializing database", 15, "正在初始化数据库…"),
        ("Database initialized", 30, "数据库已初始化"),
        ("Starting PostgreSQL", 40, "正在启动数据库服务…"),
        ("PostgreSQL started", 55, "数据库服务已就绪"),
        ("Ensuring database", 60, "正在准备业务数据库…"),
        ("Applying the WeChat channel migration", 68, "正在应用微信通道迁移…"),
        ("Synchronizing the database schema", 78, "正在同步表结构…"),
        ("Created config at", 85, "已生成配置文件"),
        ("Starting Mirrai server", 90, "正在启动服务…"),
        ("Administrator account created", 95, "管理员账号已生成，见日志"),
        ("Mirrai is running at", 100, "已就绪，正在打开浏览器…"),
    };

    public MainForm()
    {
        _appDir = AppContext.BaseDirectory;

        Text = "Mirrai";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(620, 460);
        BackColor = Color.FromArgb(250, 250, 252);
        Font = new Font("Microsoft YaHei UI", 9F);

        var title = new Label
        {
            Text = "Mirrai",
            Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold),
            ForeColor = Color.FromArgb(30, 30, 40),
            AutoSize = true,
            Location = new Point(28, 22),
        };

        var subtitle = new Label
        {
            Text = "AI 数字分身 · 本地运行",
            ForeColor = Color.FromArgb(120, 120, 135),
            AutoSize = true,
            Location = new Point(30, 62),
        };

        _status.Text = "准备中…";
        _status.Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold);
        _status.ForeColor = Color.FromArgb(30, 30, 40);
        _status.AutoSize = true;
        _status.Location = new Point(28, 104);

        _detail.Text = "首次启动需要初始化数据库，可能要一两分钟，请不要关闭窗口。";
        _detail.ForeColor = Color.FromArgb(120, 120, 135);
        _detail.AutoSize = true;
        _detail.Location = new Point(30, 136);

        _progress.Location = new Point(28, 172);
        _progress.Size = new Size(564, 20);
        _progress.Style = ProgressBarStyle.Continuous;

        _log.Multiline = true;
        _log.ReadOnly = true;
        _log.ScrollBars = ScrollBars.Vertical;
        _log.BackColor = Color.FromArgb(32, 34, 40);
        _log.ForeColor = Color.FromArgb(215, 218, 225);
        _log.Font = new Font("Consolas", 9F);
        _log.BorderStyle = BorderStyle.FixedSingle;
        _log.Location = new Point(28, 206);
        _log.Size = new Size(564, 186);

        _openBrowser.Text = "打开浏览器";
        _openBrowser.Size = new Size(110, 32);
        _openBrowser.Location = new Point(28, 408);
        _openBrowser.Enabled = false;
        _openBrowser.Click += (_, _) => OpenBrowser();

        _stop.Text = "停止并退出";
        _stop.Size = new Size(110, 32);
        _stop.Location = new Point(482, 408);
        _stop.Click += (_, _) => Close();

        Controls.AddRange(new Control[]
        {
            title, subtitle, _status, _detail, _progress, _log, _openBrowser, _stop,
        });

        FormClosing += OnFormClosing;
        Shown += (_, _) => BeginStartup();
        BuildTray();
    }

    // ─── The tray (C8.8) ────────────────────────────────────────────────

    private void BuildTray()
    {
        Icon? icon = null;
        try { icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        _trayIcon.Icon = icon ?? SystemIcons.Application;
        _trayIcon.Text = "Mirrai";
        _trayIcon.Visible = false;
        _trayIcon.DoubleClick += (_, _) => RestoreWindow();

        var menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem("打开 Mirrai");
        open.Click += (_, _) => OpenBrowser();
        var logs = new ToolStripMenuItem("看日志");
        logs.Click += (_, _) => OpenLog();
        var quit = new ToolStripMenuItem("退出");
        quit.Click += (_, _) =>
        {
            _reallyExit = true;
            _trayIcon.Visible = false;
            Close();
        };
        menu.Items.Add(open);
        menu.Items.Add(logs);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quit);
        _trayIcon.ContextMenuStrip = menu;

        // Ctrl+Alt+M opens the browser from anywhere while Mirrai runs.
        // The id is ours; MOD_CONTROL = 0x0002, MOD_ALT = 0x0001.
        RegisterHotKey(Handle, HOTKEY_OPEN, 0x0002 | 0x0001, (uint)Keys.M);
    }

    private void RestoreWindow()
    {
        Show();
        WindowState = FormWindowState.Normal;
        ShowInTaskbar = true;
        _trayIcon.Visible = false;
        Activate();
    }

    private void OpenLog()
    {
        try
        {
            if (!File.Exists(LogPath))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.WriteAllText(LogPath, string.Empty, Encoding.UTF8);
            }
            Process.Start(new ProcessStartInfo(LogPath) { UseShellExecute = true });
        }
        catch
        {
            // No default handler for .log is not worth a dialog.
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_OPEN)
        {
            OpenBrowser();
            return;
        }
        base.WndProc(ref m);
    }

    // ─── Startup ────────────────────────────────────────────────────────────

    private void BeginStartup()
    {
        var script = Path.Combine(_appDir, "start.ps1");
        if (!File.Exists(script))
        {
            Fail("找不到启动脚本 start.ps1", "The start script is missing. Please reinstall Mirrai.");
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -File \"{script}\"",
            WorkingDirectory = _appDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        try
        {
            _process = Process.Start(psi);
        }
        catch (Exception ex)
        {
            Fail("无法启动 Mirrai", ex.Message);
            return;
        }

        if (_process is null)
        {
            Fail("无法启动 Mirrai", "The start script could not be started.");
            return;
        }

        _process.OutputDataReceived += (_, e) => OnOutput(e.Data);
        _process.ErrorDataReceived += (_, e) => OnOutput(e.Data);
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
        _process.Exited += (_, _) => OnProcessExited();
    }

    private void OnOutput(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;

        if (line.Contains("ERROR:", StringComparison.OrdinalIgnoreCase))
        {
            Append("! " + line);
            return;
        }

        Append(line);

        foreach (var (marker, percent, status) in Stages)
        {
            if (!line.Contains(marker, StringComparison.OrdinalIgnoreCase)) continue;
            SetProgress(percent, status);
            if (percent == 100) OnReady();
            break;
        }
    }

    private void OnProcessExited()
    {
        if (_closing) return;
        BeginInvoke(() =>
        {
            if (_ready) return;
            Fail("Mirrai 启动失败", "Mirrai stopped before it finished starting up.");
        });
    }

    private void OnReady()
    {
        if (_ready) return;
        _ready = true;
        _openBrowser.Enabled = true;
        _status.Text = "已就绪";
        _detail.Text = "Mirrai 正在运行。关掉这个窗口它会留在任务栏托盘里；从托盘菜单可以退出。";
        OpenBrowser();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private void SetProgress(int percent, string status)
    {
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            _progress.Value = Math.Clamp(percent, 0, 100);
            _status.Text = status;
        });
    }

    private void Append(string line)
    {
        WriteLogLine(line);
        if (IsDisposed) return;
        BeginInvoke(() =>
        {
            _log.AppendText(line.TrimEnd() + Environment.NewLine);
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        });
    }

    private void Fail(string status, string detail)
    {
        _progress.Style = ProgressBarStyle.Continuous;
        _progress.Value = 0;
        _status.Text = status;
        _detail.Text = detail;
        _status.ForeColor = Color.FromArgb(180, 40, 50);
    }

    private static void OpenBrowser()
    {
        try
        {
            Process.Start(new ProcessStartInfo("http://localhost:3000") { UseShellExecute = true });
        }
        catch
        {
            // The user can still open the address by hand.
        }
    }

    // ─── Shutdown ───────────────────────────────────────────────────────────

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        /**
         * Closing the window is not quitting (C8.8).
         *
         * It puts the launcher in the tray and leaves the server
         * running. 退出 in the tray menu — or Windows shutting the
         * process down — is the real exit.
         */
        if (!_reallyExit && e.CloseReason == CloseReason.UserClosing && _ready)
        {
            e.Cancel = true;
            Hide();
            ShowInTaskbar = false;
            _trayIcon.Visible = true;
            return;
        }
        _closing = true;
        _trayIcon.Visible = false;
        UnregisterHotKey(Handle, HOTKEY_OPEN);
        StopMirrai();
    }

    /// <summary>
    /// Stops the start script and everything it started, plus the database
    /// server, which pg_ctl leaves running outside of the script's tree.
    /// </summary>
    private void StopMirrai()
    {
        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Best effort.
        }

        try
        {
            var pgCtl = Path.Combine(_appDir, "pgsql", "bin", "pg_ctl.exe");
            var pgData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Mirrai", "pgdata");
            if (File.Exists(pgCtl) && Directory.Exists(pgData))
            {
                var psi = new ProcessStartInfo
                {
                    FileName = pgCtl,
                    Arguments = $"-D \"{pgData}\" -m fast stop",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using var pg = Process.Start(psi);
                pg?.WaitForExit(10000);
            }
        }
        catch
        {
            // Best effort.
        }
    }
}
