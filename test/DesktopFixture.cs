using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

class DesktopFixture {
    [STAThread]
    static void Main(string[] args) {
        Application.EnableVisualStyles();
        Form form = new Form { Text = "UI-TARS Local Control Test", Size = new Size(700, 450), StartPosition = FormStartPosition.CenterScreen, BackColor = Color.White };
        Label heading = new Label { Text = "Local control test", Location = new Point(35, 30), Size = new Size(600, 45), Font = new Font("Segoe UI", 22) };
        Label caption = new Label { Text = "Enter the test phrase below, then click Confirm.", Location = new Point(35, 100), Size = new Size(610, 35), Font = new Font("Segoe UI", 13) };
        TextBox input = new TextBox { Location = new Point(35, 160), Size = new Size(610, 45), Font = new Font("Segoe UI", 18) };
        Button confirm = new Button { Text = "Confirm", Location = new Point(35, 235), Size = new Size(190, 55), Font = new Font("Segoe UI", 15), BackColor = Color.LightSkyBlue };
        Label status = new Label { Text = "Waiting", Location = new Point(35, 320), Size = new Size(610, 50), Font = new Font("Segoe UI", 16) };
        confirm.Click += delegate { status.Text = "Confirmed: " + input.Text; File.WriteAllText(args[0], input.Text); };
        form.Controls.AddRange(new Control[] { heading, caption, input, confirm, status });
        Application.Run(form);
    }
}
