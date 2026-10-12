// B14-13 offline tests only: an inert stand-in for AirDroid's Dialpad, so the helper's lock, final number check and
// single dispatch can be exercised without AirDroid, a phone or a call. Built into IaosFakeAirDroid.exe by
// test-airdroid-dial-concurrency.cjs; the helper finds it only when given -TestProcessName IaosFakeAirDroid.
// Shape matches what PrepareCall.ps1 / DialCall.ps1 look for: a main window named "AirDroid"; one visible
// "frmAirCloud" pane holding exactly one EDIT field; one 12-key grid; one full-width panel below it (Make Call).
// Every change of the number field and every Make Call click is appended to the log file (args[0]) with the
// field's text at that moment. Each change between minimised and normal is logged too (MINIMIZED / RESTORED).
// With args[1] == "--taskbar" the main window is a normal unowned taskbar window, like the real AirDroid main window
// (test-airdroid-minimize.cjs); without it, the concurrency test's original setup is unchanged.
// Start-up simulation (test-airdroid-start.cjs), any order after args[0]: "--window-after=MS" shows the main window
// only after MS ms; "--dialpad-after=MS" shows the device page (frmAirCloud with the field) only MS ms after the
// window; "--no-dialpad" never shows it. Without these flags the window and Dialpad appear at once, as before.
// Tray simulation (Brad, VivoBook, 2026-10-12): "--tray" HIDES the main window whenever it is minimised (logged HIDDEN),
// as a tray application does; "--start-hidden" opens it hidden (logged HIDDEN). A hidden window is not in the UI
// Automation tree. "--taskbar" may now appear anywhere after args[0].
// Second form (Brad, VivoBook diagnostic, 2026-10-12): "--second-form" adds another unowned top-level window titled
// "AirDroid" with five text fields and no Dialpad, hidden from the start (as on the real AirDroid);
// "--second-dialpad" makes that second form Dialpad-shaped too (an ambiguity the helper must refuse). Any time the
// second form becomes visible it is logged OTHER-SHOWN.
// VivoBook visible-Dialpad layout (Brad's diagnostic, 2026-10-12): "--hidden-page" adds a second, hidden "frmAirCloud"
// page with its own number field inside the main window (the real main window has 2 pages and 2 fields);
// "--second-visible" leaves the second form VISIBLE; "--size=WxH" sets the main window size (a small corner window);
// "--start-minimized" opens the main window minimised (still on the taskbar, not hidden).
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

public static class FakeAirDroid {
  static string logPath;
  static void Log(string line) {
    File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
  }

  [STAThread]
  public static void Main(string[] args) {
    logPath = args[0];
    int windowAfter = 0, dialpadAfter = 0; bool noDialpad = false;
    for (int a = 1; a < args.Length; a++) {
      if (args[a].StartsWith("--window-after=")) windowAfter = int.Parse(args[a].Substring(15));
      else if (args[a].StartsWith("--dialpad-after=")) dialpadAfter = int.Parse(args[a].Substring(16));
      else if (args[a] == "--no-dialpad") noDialpad = true;
    }
    if (windowAfter > 0) { Log("STARTED"); System.Threading.Thread.Sleep(windowAfter); }
    int mw = 360, mh = 520;
    foreach (var a in args) if (a.StartsWith("--size=")) { var wh = a.Substring(7).Split('x'); mw = int.Parse(wh[0]); mh = int.Parse(wh[1]); }
    var main = new Form { Text = "AirDroid", Width = mw, Height = mh, StartPosition = FormStartPosition.Manual,
      Location = new Point(40, 40), ShowInTaskbar = Array.IndexOf(args, "--taskbar") > 0 };
    bool tray = Array.IndexOf(args, "--tray") > 0;
    bool startHidden = Array.IndexOf(args, "--start-hidden") > 0;
    var page = new Panel { Text = "frmAirCloud", AccessibleName = "frmAirCloud", Dock = DockStyle.Fill,
      Visible = !noDialpad && dialpadAfter == 0 };
    if (!noDialpad && dialpadAfter > 0) {
      var reveal = new Timer { Interval = dialpadAfter };
      reveal.Tick += (s, e) => { reveal.Stop(); page.Visible = true; Log("DIALPAD"); };
      main.Shown += (s, e) => reveal.Start();
    }
    var field = new TextBox { Left = 20, Top = 16, Width = 240 };
    var grid = new Panel { Left = 20, Top = 60, Width = 260, Height = 360 };
    for (int i = 0; i < 12; i++) {
      grid.Controls.Add(new Panel { Left = (i % 3) * 70, Top = (i / 3) * 50, Width = 60, Height = 40,
        BackColor = Color.LightGray });
    }
    var makeCall = new Panel { Left = 0, Top = 210, Width = 220, Height = 44, BackColor = Color.LightGreen };
    grid.Controls.Add(makeCall);
    page.Controls.Add(field);
    if (Array.IndexOf(args, "--hidden-page") > 0) {
      var hiddenPage = new Panel { Text = "frmAirCloud", AccessibleName = "frmAirCloud", Left = 0, Top = 0, Width = 200, Height = 100, Visible = false };
      hiddenPage.Controls.Add(new TextBox { Left = 10, Top = 10, Width = 150 });
      main.Controls.Add(hiddenPage);
    }
    page.Controls.Add(grid);
    main.Controls.Add(page);
    field.TextChanged += (s, e) => Log("TEXT " + field.Text);
    makeCall.MouseUp += (s, e) => Log("CLICK " + field.Text);
    main.Shown += (s, e) => Log("READY");
    var state = FormWindowState.Normal;
    main.Resize += (s, e) => {
      if (main.WindowState == state) return;
      state = main.WindowState;
      Log(state == FormWindowState.Minimized ? "MINIMIZED" : "RESTORED");
      if (tray && state == FormWindowState.Minimized) { main.Hide(); Log("HIDDEN"); }
    };
    if (Array.IndexOf(args, "--start-minimized") > 0) { main.WindowState = FormWindowState.Minimized; state = FormWindowState.Minimized; }
    if (startHidden) {
      // Shown, then hidden at once: a started tray application with no visible window.
      main.WindowState = FormWindowState.Minimized; state = FormWindowState.Minimized;
      main.Shown += (s, e) => { main.Hide(); Log("HIDDEN"); };
    }
    bool second = Array.IndexOf(args, "--second-form") > 0, secondDial = Array.IndexOf(args, "--second-dialpad") > 0;
    if (second || secondDial) {
      var other = new Form { Text = "AirDroid", Width = 820, Height = 520, StartPosition = FormStartPosition.Manual,
        Location = new Point(420, 40), ShowInTaskbar = true };
      if (secondDial) {
        var p2 = new Panel { Text = "frmAirCloud", AccessibleName = "frmAirCloud", Dock = DockStyle.Fill };
        p2.Controls.Add(new TextBox { Left = 20, Top = 16, Width = 240 });
        var g2 = new Panel { Left = 20, Top = 60, Width = 260, Height = 360 };
        for (int i = 0; i < 12; i++) g2.Controls.Add(new Panel { Left = (i % 3) * 70, Top = (i / 3) * 50, Width = 60, Height = 40 });
        g2.Controls.Add(new Panel { Left = 0, Top = 210, Width = 220, Height = 44 });
        p2.Controls.Add(g2); other.Controls.Add(p2);
      } else {
        for (int i = 0; i < 5; i++) other.Controls.Add(new TextBox { Left = 20, Top = 20 + i * 40, Width = 300 });
      }
      bool armed = false;
      other.VisibleChanged += (s, e) => { if (armed && other.Visible) Log("OTHER-SHOWN"); };
      bool keepVisible = Array.IndexOf(args, "--second-visible") > 0;
      main.Shown += (s, e) => { other.Show(); if (!keepVisible) other.Hide(); armed = !keepVisible; Log("SECOND-READY"); };
    }
    Application.Run(main);
  }
}
