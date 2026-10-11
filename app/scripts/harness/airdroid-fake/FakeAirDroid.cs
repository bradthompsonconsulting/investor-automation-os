// B14-13 offline tests only: an inert stand-in for AirDroid's Dialpad, so the helper's lock, final number check and
// single dispatch can be exercised without AirDroid, a phone or a call. Built into IaosFakeAirDroid.exe by
// test-airdroid-dial-concurrency.cjs; the helper finds it only when given -TestProcessName IaosFakeAirDroid.
// Shape matches what PrepareCall.ps1 / DialCall.ps1 look for: a main window named "AirDroid"; one visible
// "frmAirCloud" pane holding exactly one EDIT field; one 12-key grid; one full-width panel below it (Make Call).
// Every change of the number field and every Make Call click is appended to the log file (args[0]) with the
// field's text at that moment.
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
    var main = new Form { Text = "AirDroid", Width = 360, Height = 520, StartPosition = FormStartPosition.Manual,
      Location = new Point(40, 40), ShowInTaskbar = false };
    var page = new Panel { Text = "frmAirCloud", AccessibleName = "frmAirCloud", Dock = DockStyle.Fill };
    var field = new TextBox { Left = 20, Top = 16, Width = 240 };
    var grid = new Panel { Left = 20, Top = 60, Width = 260, Height = 360 };
    for (int i = 0; i < 12; i++) {
      grid.Controls.Add(new Panel { Left = (i % 3) * 70, Top = (i / 3) * 50, Width = 60, Height = 40,
        BackColor = Color.LightGray });
    }
    var makeCall = new Panel { Left = 0, Top = 210, Width = 220, Height = 44, BackColor = Color.LightGreen };
    grid.Controls.Add(makeCall);
    page.Controls.Add(field);
    page.Controls.Add(grid);
    main.Controls.Add(page);
    field.TextChanged += (s, e) => Log("TEXT " + field.Text);
    makeCall.MouseUp += (s, e) => Log("CLICK " + field.Text);
    main.Shown += (s, e) => Log("READY");
    Application.Run(main);
  }
}
