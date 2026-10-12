// B14-13 offline tests only: an inert, unrelated top-level window (a browser or editor stand-in) for
// test-airdroid-minimize.cjs, which checks that minimising AirDroid after the dial leaves such windows untouched.
// Built into IaosFakeWindow.exe by that test. It does nothing except log READY and each foreground gain or loss
// (ACTIVATED / DEACTIVATED), with a timestamp, to args[0]. Its title is args[1].
// "--grant-foreground" (test-airdroid-visible.cjs): while it is the foreground window it calls
// AllowSetForegroundWindow(ASFW_ANY), as the foreground browser does for the IAOS link handler it launches, so the
// helper may bring AirDroid in front. Without it, Windows' foreground lock refuses the helper (a realistic refusal).
// "--launcher <dir>": the browser stand-in LAUNCHES the IAOS link handler itself, as Chrome does when Brad clicks Call:
// when <dir>\launch.txt appears (line 1: program, line 2: arguments) it starts that program with its own console
// window (shell execute, like a protocol launch) and, when it exits, writes its exit code to <dir>\exit.txt.
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

public static class FakeWindow {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
  static string logPath;
  static void Log(string line) {
    File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
  }

  [STAThread]
  public static void Main(string[] args) {
    logPath = args[0];
    var main = new Form { Text = args.Length > 1 ? args[1] : "IAOS fake window", Width = 520, Height = 400,
      StartPosition = FormStartPosition.Manual, Location = new Point(440, 80) };
    bool grant = Array.IndexOf(args, "--grant-foreground") > 1;
    main.Activated += (s, e) => { Log("ACTIVATED"); if (grant) Log(AllowSetForegroundWindow(-1) ? "GRANTED" : "GRANT-FAILED"); };
    main.Deactivate += (s, e) => Log("DEACTIVATED");
    main.Shown += (s, e) => Log("READY");
    int li = Array.IndexOf(args, "--launcher");
    if (li > 1 && li + 1 < args.Length) {
      string dir = args[li + 1];
      var t = new Timer { Interval = 100 };
      t.Tick += (s, e) => {
        string req = Path.Combine(dir, "launch.txt");
        if (!File.Exists(req)) return;
        string[] lines = File.ReadAllLines(req); File.Delete(req);
        var p = new System.Diagnostics.Process { StartInfo = new System.Diagnostics.ProcessStartInfo(lines[0], lines[1]) { UseShellExecute = true }, EnableRaisingEvents = true };
        p.Exited += (s2, e2) => File.WriteAllText(Path.Combine(dir, "exit.txt"), p.ExitCode.ToString());
        p.Start(); Log("LAUNCHED");
      };
      t.Start();
    }
    Application.Run(main);
  }
}
