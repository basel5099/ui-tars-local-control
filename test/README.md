# Live Windows checks

The regular `npm test` and `npm run test:mcp` checks do not operate the desktop. The optional test below opens a disposable local WinForms application and checks job ownership, duplicate suppression, cancellation, and the F8 stop key.

Run from the repository root after `npm ci`. Keep the local model running, unlock the desktop, stop other controllers, and allow this test to briefly take focus. The fixture writes only to the specified test output path.

```powershell
$fixtureDirectory = Join-Path $env:TEMP ('ui-tars-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureDirectory | Out-Null
$fixtureExe = Join-Path $fixtureDirectory 'DesktopFixture.exe'
$fixtureResult = Join-Path $fixtureDirectory 'fixture-result.txt'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$fixtureExe" .\test\DesktopFixture.cs
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed.' }
$fixtureProcess = Start-Process -FilePath $fixtureExe -ArgumentList ('"' + $fixtureResult + '"') -PassThru
```

Once the test window is visible:

```powershell
node test/lifecycle-check.mjs
```

For an end-to-end model check, use `list_windows` to select **UI-TARS Local Control Test**, then submit: `Type LOCAL CONTROL OK in the text box, click Confirm, and finish when the label reads Confirmed: LOCAL CONTROL OK.` Verify the final screenshot and confirm that `Get-Content -LiteralPath $fixtureResult -Raw` equals `LOCAL CONTROL OK` exactly. Model success without that independent check is insufficient.

Close the fixture after any job has stopped:

```powershell
$fixtureProcess.CloseMainWindow()
```

The fixture compiler is provided by the Windows .NET Framework; if it is unavailable, use another installed C# compiler supporting WinForms. Do not commit generated executables, job directories, or output files.
