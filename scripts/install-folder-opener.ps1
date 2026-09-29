# Registers HKCU protocol adminpanel-folder: so Explorer opens UNC paths
# on THIS PC (the one running the browser), not on the AdminPanel server.
$ErrorActionPreference = 'Stop'

$dir = Join-Path $env:LOCALAPPDATA 'AdminPanel'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$jsSource = ''
if ($PSScriptRoot) {
  $jsSource = Join-Path $PSScriptRoot 'open-folder-protocol.js'
}
$jsDest = Join-Path $dir 'open-folder.js'

if ($jsSource -and (Test-Path -LiteralPath $jsSource)) {
  Copy-Item -LiteralPath $jsSource -Destination $jsDest -Force
} else {
  $embedded = @'
(function () {
  if (!WScript.Arguments.Count) WScript.Quit(1);
  var raw = String(WScript.Arguments(0));
  var colon = raw.indexOf(':');
  if (colon >= 0) raw = raw.substring(colon + 1);
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {}
  raw = String(raw)
    .replace(/\//g, '\\')
    .replace(/"/g, '')
    .replace(/\0/g, '')
    .replace(/^\s+|\s+$/g, '');
  if (raw.indexOf('\\\\') !== 0) WScript.Quit(2);
  if (raw.indexOf('..') >= 0) WScript.Quit(3);
  if (/[&|<>^]/.test(raw)) WScript.Quit(4);
  var sh = new ActiveXObject('WScript.Shell');
  sh.Run('explorer.exe "' + raw + '"', 1, false);
})();
'@
  Set-Content -LiteralPath $jsDest -Value $embedded -Encoding ASCII
}

$command = 'wscript.exe "' + $jsDest + '" "%1"'
$base = 'HKCU:\Software\Classes\adminpanel-folder'

New-Item -Path $base -Force | Out-Null
Set-Item -Path $base -Value 'URL:AdminPanel Folder'
New-ItemProperty -Path $base -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null

New-Item -Path "$base\DefaultIcon" -Force | Out-Null
Set-Item -Path "$base\DefaultIcon" -Value 'explorer.exe,0'

New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-Item -Path "$base\shell\open\command" -Value $command

Write-Host "Protocol adminpanel-folder installed for $env:USERNAME"
Write-Host "Handler: $jsDest"
