param([string]$Message = "Aeryx needs your approval for a Class-3 action.")

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FG {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@
$hwnd = [FG]::GetConsoleWindow()
if ($hwnd -ne [IntPtr]::Zero) {
  [FG]::ShowWindow($hwnd, 9) | Out-Null
  [FG]::SetForegroundWindow($hwnd) | Out-Null
}
Write-Host "AERYX: $Message"
Write-Host "Windows Hello is being requested - answer the prompt."

[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$result = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($Message)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
Write-Host "verification result: $result"
if ($result -eq 'Verified') { exit 0 } else { exit 1 }
