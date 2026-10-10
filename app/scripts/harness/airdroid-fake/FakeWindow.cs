// B14-13 offline tests only: an inert, unrelated top-level window (a browser or editor stand-in) for
// test-airdroid-minimize.cjs, which checks that minimising AirDroid after the dial leaves such windows untouched.
// Built into IaosFakeWindow.exe by that test. It does nothing except log READY and each foreground gain or loss
// (ACTIVATED / DEACTIVATED), with a timestamp, to args[0]. Its title is args[1].
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

public static class FakeWindow {
  static string logPath;
  static void Log(string line) {
    File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
  }

  [STAThread]
  public static void Main(string[] args) {
    logPath = args[0];
    var main = new Form { Text = args.Length > 1 ? args[1] : "IAOS fake window", Width = 520, Height = 400,
      StartPosition = FormStartPosition.Manual, Location = new Point(440, 80) };
    main.Activated += (s, e) => Log("ACTIVATED");
    main.Deactivate += (s, e) => Log("DEACTIVATED");
    main.Shown += (s, e) => Log("READY");
    Application.Run(main);
  }
}
