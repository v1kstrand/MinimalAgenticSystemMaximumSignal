[CmdletBinding()]
param(
  [int]$MaxIterations = 0,
  [string]$ConfigPath = ".plans/loop.config.json"
)

$defaults = [ordered]@{
  agentCommand   = "codex"
  agentArgs      = @("--prompt-file")
  maxIterations  = 8
  completionRegex = "<promise>COMPLETE</promise>"
  logDir         = ".plans/logs"
  stopOnError    = $true
}

$cfg = $null
if (Test-Path $ConfigPath) {
  try {
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  } catch {
    Write-Error "Failed to parse $ConfigPath"
    exit 1
  }
}

function Get-ConfigValue($name, $default) {
  if ($null -ne $cfg -and $cfg.PSObject.Properties.Name -contains $name -and $null -ne $cfg.$name) {
    return $cfg.$name
  }
  return $default
}

$agentCommand = Get-ConfigValue "agentCommand" $defaults.agentCommand
$agentArgs = Get-ConfigValue "agentArgs" $defaults.agentArgs
$completionRegex = Get-ConfigValue "completionRegex" $defaults.completionRegex
$logDir = Get-ConfigValue "logDir" $defaults.logDir
$stopOnError = Get-ConfigValue "stopOnError" $defaults.stopOnError

$maxIterations = if ($MaxIterations -gt 0) { $MaxIterations } else { [int](Get-ConfigValue "maxIterations" $defaults.maxIterations) }

if (-not (Get-Command $agentCommand -ErrorAction SilentlyContinue)) {
  Write-Error "Agent command not found: $agentCommand"
  exit 1
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

for ($i = 1; $i -le $maxIterations; $i++) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $promptPath = Join-Path $logDir "iter-$i-$timestamp.prompt.md"
  $logPath = Join-Path $logDir "iter-$i-$timestamp.log"

  Copy-Item -Force .plans/PROMPT.md $promptPath

  Write-Host "=== Ralph loop iteration $i ==="
  Write-Host "Prompt: $promptPath"
  Write-Host "Log:    $logPath"

  $finalArgs = @()
  $usedPlaceholder = $false
  foreach ($arg in $agentArgs) {
    if ($arg -eq \"{prompt}\") {
      $finalArgs += $promptPath
      $usedPlaceholder = $true
    } else {
      $finalArgs += $arg
    }
  }
  if (-not $usedPlaceholder) {
    $finalArgs += $promptPath
  }

  & $agentCommand @finalArgs 2>&1 | Tee-Object -FilePath $logPath
  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0 -and $stopOnError) {
    Write-Error "Agent exited with code $exitCode"
    exit $exitCode
  }

  $logText = Get-Content $logPath -Raw
  if ($logText -match $completionRegex) {
    Write-Host "Loop complete: completion marker found."
    exit 0
  }
}

Write-Error "Max iterations reached without completion."
exit 2
