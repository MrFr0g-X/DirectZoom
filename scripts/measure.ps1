# Samples CPU (% of one core, summed over all DirectZoom processes), RAM and GPU engine usage.
# Usage: pwsh scripts/measure.ps1 -Seconds 10 [-Match 'D:\directzoom\app\*']
param([int]$Seconds = 10, [string]$Match = 'D:\directzoom\app\*')

function Snapshot {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like $Match -or $_.Name -in 'dzcap.exe', 'ffmpeg.exe' } |
    ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ Id = $p.Id; Cpu = $p.TotalProcessorTime.TotalSeconds; Ram = $p.WorkingSet64; Private = $p.PrivateMemorySize64 } } }
}
$ids = { param($s) $s | ForEach-Object Id }
$a = Snapshot
$gpu = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples $Seconds -ErrorAction SilentlyContinue
$b = Snapshot
$cpu = 0
foreach ($p in $b) { $prev = $a | Where-Object Id -eq $p.Id; if ($prev) { $cpu += $p.Cpu - $prev.Cpu } }
$pids = & $ids $b
$gpuOurs = 0
if ($gpu) {
  $byPid = @{}
  foreach ($s in $gpu.CounterSamples) {
    if ($s.InstanceName -match 'pid_(\d+)_' -and $pids -contains [int]$Matches[1]) { $byPid[$s.Path] = ($byPid[$s.Path] + $s.CookedValue) }
  }
  $gpuOurs = (($byPid.Values | Measure-Object -Sum).Sum) / $Seconds
}
[pscustomobject]@{
  Processes = $b.Count
  CpuPercentOfOneCore = [math]::Round(100 * $cpu / $Seconds, 1)
  RamMB = [math]::Round((($b | Measure-Object Ram -Sum).Sum) / 1MB)
  PrivateMB = [math]::Round((($b | Measure-Object Private -Sum).Sum) / 1MB)
  GpuPercent = [math]::Round($gpuOurs, 1)
} | ConvertTo-Json -Compress
