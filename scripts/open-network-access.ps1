# Requires Administrator. Opens inbound TCP 4000 for AdminPanel LAN access.
$ErrorActionPreference = 'Stop'
$name = 'AdminPanel Gateway 4000'
$existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($existing) {
  Set-NetFirewallRule -DisplayName $name -Enabled True -Action Allow -Direction Inbound
  Write-Host "Updated firewall rule: $name"
} else {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000 -Profile Any | Out-Null
  Write-Host "Created firewall rule: $name"
}

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "AdminPanel is reachable at:"
foreach ($ip in $ips) {
  Write-Host "  http://${ip}:4000"
}
Write-Host ""
Write-Host "Press Enter to close..."
[void][Console]::ReadLine()
