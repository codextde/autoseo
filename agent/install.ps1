# AutoSEO local agent installer (Windows PowerShell 5.1+ / PowerShell 7+).
#
#   $env:AUTOSEO_AGENT_TOKEN='<TOKEN>'; iwr -useb __AUTOSEO_HOST__/install.ps1 | iex; Install-AutoSEOAgent -HostUrl __AUTOSEO_HOST__
#
# Parameters of Install-AutoSEOAgent:
#   -Token <token>        Agent token (default: $env:AUTOSEO_AGENT_TOKEN — preferred, keeps it out of process args)
#   -HostUrl <url>        AutoSEO server URL (alias: -Host / -Server; default: __AUTOSEO_HOST__)
#   -Runtime <name>       claude | codex | detect (default: detect)
#   -WorkDir <dir>        Folder for job sessions (default: %TEMP%\autoseo-agent)
#   -MaxParallel <n>      Parallel jobs on this machine (default: server setting)
#   -NoAutoUpdate         Never self-update (update by re-running the installer)
#   -NoAutostart          Don't register the Scheduled Task (start run.ps1 yourself)
#   -InstallDir <dir>     Install directory (default: %USERPROFILE%\.autoseo-agent)
#
# Local security policy (only you decide — the dashboard can never widen it):
#   -AllowFull            Full CLI mode for YOUR OWN chats/agentic jobs (exposes your Claude Code MCP servers)
#   -McpServers <list>    Which MCP servers Full mode exposes: all (default) | none | a,b,c
#   -AllowCodexShell      Let Codex use its (read-only) shell tool for your own jobs
#   -AllowRemoteWorkdir   Accept work directories set in the dashboard outside -WorkDir
#
#   Uninstall:  iwr -useb __AUTOSEO_HOST__/install.ps1 | iex; Uninstall-AutoSEOAgent
#
# The agent only makes outbound HTTPS requests to your AutoSEO server; it opens no ports.

$script:AutoSEOTaskName = 'AutoSEO Agent'

function Stop-AutoSEOAgentProcess {
  param([string]$InstallDir)
  # Best effort: never abort the (un)install because nothing was running.
  $ErrorActionPreference = 'Continue'
  # Kill the supervisor's whole process tree (incl. node.exe and running CLI sessions) FIRST —
  # Stop-ScheduledTask only ends the supervisor itself and would orphan node.exe.
  $pidFile = Join-Path $InstallDir 'agent.pid'
  if (Test-Path $pidFile) {
    $supervisorPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($supervisorPid) {
      try { Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', "$supervisorPid", '/T', '/F') -NoNewWindow -Wait -ErrorAction SilentlyContinue | Out-Null } catch { }
    }
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
  }
  # Any agent process still running from this install dir (e.g. started manually).
  try {
    $agentFile = Join-Path $InstallDir 'agent.mjs'
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($agentFile) } |
      ForEach-Object { Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', "$($_.ProcessId)", '/T', '/F') -NoNewWindow -Wait -ErrorAction SilentlyContinue | Out-Null }
  } catch { }
  $task = Get-ScheduledTask -TaskName $script:AutoSEOTaskName -ErrorAction SilentlyContinue
  if ($task) { Stop-ScheduledTask -TaskName $script:AutoSEOTaskName -ErrorAction SilentlyContinue }
}

function Install-AutoSEOAgent {
  [CmdletBinding()]
  param(
    [string]$Token = $env:AUTOSEO_AGENT_TOKEN,
    [Alias('Host', 'Server', 'Url')][string]$HostUrl = '__AUTOSEO_HOST__',
    [ValidateSet('claude', 'codex', 'detect')][string]$Runtime,
    [string]$WorkDir,
    [int]$MaxParallel = 0,
    [switch]$NoAutoUpdate,
    [switch]$NoAutostart,
    [switch]$AllowFull,
    [string]$McpServers = 'all',
    [switch]$AllowCodexShell,
    [switch]$AllowRemoteWorkdir,
    [string]$InstallDir = (Join-Path $env:USERPROFILE '.autoseo-agent')
  )
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  if (-not $Token) { throw 'Missing token. Copy the install command from AutoSEO -> Local Agents -> Install agent.' }
  Remove-Item Env:AUTOSEO_AGENT_TOKEN -ErrorAction SilentlyContinue
  $HostUrl = $HostUrl.TrimEnd('/')
  $hostOk = $HostUrl -match '^https://' -or $HostUrl -match '^http://(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.localhost|[^/:]+\.test)(:\d+)?(/|$)'
  if (-not $hostOk) { throw '-HostUrl must use https:// (plain http is only allowed for localhost / *.test)' }
  $releaseKey = '__AUTOSEO_AGENT_PUBKEY__'

  # Node.js >= 20 (Claude Code / Codex users have it)
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path $c) { $nodeCmd = Get-Command $c; break } }
  }
  if (-not $nodeCmd) { throw 'Node.js 20+ is required. Install it from https://nodejs.org and re-run.' }
  $node = $nodeCmd.Source
  $major = [int](& $node -p "process.versions.node.split('.')[0]")
  if ($major -lt 20) { throw "Node.js 20+ is required (found $(& $node -v))." }

  Write-Host "> Installing AutoSEO agent into $InstallDir" -ForegroundColor Green
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null
  try { Start-Process -FilePath 'icacls.exe' -ArgumentList @("`"$InstallDir`"", '/inheritance:r', '/grant:r', "$($env:USERNAME):(OI)(CI)F") -NoNewWindow -Wait -ErrorAction SilentlyContinue | Out-Null } catch { }

  $tmp = Join-Path $env:TEMP ("autoseo-agent-" + [guid]::NewGuid().ToString('N') + '.mjs')
  Invoke-WebRequest -UseBasicParsing -Uri "$HostUrl/install/agent.mjs" -OutFile $tmp
  $shaContent = (Invoke-WebRequest -UseBasicParsing -Uri "$HostUrl/install/agent.sha256").Content
  if ($shaContent -is [byte[]]) { $shaContent = [Text.Encoding]::UTF8.GetString($shaContent) }
  $shaLines = @($shaContent -split "`r?`n")
  $expected = $shaLines[0].Trim().ToLower()
  $version = if ($shaLines.Count -gt 1) { $shaLines[1].Trim() } else { '' }
  $actual = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
  if (-not $expected -or $expected -ne $actual) {
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
    throw "Checksum mismatch for agent.mjs (expected $expected, got $actual)"
  }
  $sigFile = "$tmp.sig"
  Invoke-WebRequest -UseBasicParsing -Uri "$HostUrl/install/agent.sig" -OutFile $sigFile
  # JS without double quotes (Windows PowerShell 5.1 mangles embedded quotes in native arguments).
  $verify = 'const c=require(`crypto`),fs=require(`fs`);const k=c.createPublicKey({key:Buffer.from(process.argv[1],`base64`),format:`der`,type:`spki`});process.exit(c.verify(null,fs.readFileSync(process.argv[2]),k,Buffer.from(fs.readFileSync(process.argv[3],`utf8`).trim(),`base64`))?0:1)'
  & $node -e $verify $releaseKey $tmp $sigFile
  $sigOk = $LASTEXITCODE -eq 0
  Remove-Item -Force $sigFile -ErrorAction SilentlyContinue
  if (-not $sigOk) {
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
    throw 'Release signature check failed for agent.mjs'
  }

  Stop-AutoSEOAgentProcess -InstallDir $InstallDir
  Move-Item -Force $tmp (Join-Path $InstallDir 'agent.mjs')
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $InstallDir 'agent.mjs.prev')
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $InstallDir 'update.json')

  $autostart = if ($NoAutostart) { 'none' } else { 'task' }
  $env:AUTOSEO_AGENT_HOME = $InstallDir
  # The token is passed via the environment so it never shows up in process listings.
  $env:AUTOSEO_AGENT_TOKEN = $Token
  $cfgArgs = @('configure', '--host', $HostUrl, '--autostart', $autostart, '--path', $env:PATH)
  if ($Runtime) { $cfgArgs += @('--runtime', $Runtime) }
  if ($WorkDir) { $cfgArgs += @('--workdir', $WorkDir) }
  if ($MaxParallel -gt 0) { $cfgArgs += @('--max-parallel', "$MaxParallel") }
  if ($NoAutoUpdate) { $cfgArgs += '--no-auto-update' } else { $cfgArgs += '--auto-update' }
  $yn = { param($b) if ($b) { 'yes' } else { 'no' } }
  $cfgArgs += @('--allow-full', (& $yn $AllowFull.IsPresent), '--mcp-servers', $McpServers, '--allow-codex-shell', (& $yn $AllowCodexShell.IsPresent), '--allow-remote-workdir', (& $yn $AllowRemoteWorkdir.IsPresent))
  & $node (Join-Path $InstallDir 'agent.mjs') @cfgArgs | Out-Null
  $configured = $LASTEXITCODE
  Remove-Item Env:AUTOSEO_AGENT_TOKEN -ErrorAction SilentlyContinue
  if ($configured -ne 0) { throw 'Could not write the agent configuration.' }

  # Supervisor: restarts the agent after self-updates (exit 75) and crashes; rolls back a broken update.
  $runPs1 = @'
# AutoSEO agent supervisor (generated by install.ps1).
$ErrorActionPreference = 'Continue'
$dir = '__DIR__'
$node = '__NODE__'
$env:PATH = '__PATH__'
$env:AUTOSEO_AGENT_HOME = $dir
$env:AUTOSEO_AGENT_SUPERVISED = '1'
Set-Content -Path (Join-Path $dir 'agent.pid') -Value $PID
$fails = 0
while ($true) {
  $start = Get-Date
  & $node (Join-Path $dir 'agent.mjs') run
  $code = $LASTEXITCODE
  if ($code -eq 0) { break }
  if ($code -eq 75) { $fails = 0; continue }
  if (((Get-Date) - $start).TotalSeconds -lt 30) { $fails++ } else { $fails = 0 }
  $marker = Join-Path $dir 'update.json'
  $prev = Join-Path $dir 'agent.mjs.prev'
  if ($fails -ge 3 -and (Test-Path $marker) -and (Test-Path $prev)) {
    Add-Content -Path (Join-Path $dir 'logs\supervisor.log') -Value "$(Get-Date -Format o) new agent version keeps crashing - rolling back"
    Move-Item -Force $prev (Join-Path $dir 'agent.mjs')
    Remove-Item -Force $marker
    $fails = 0
  }
  Start-Sleep -Seconds ([int][Math]::Min(60, [Math]::Pow(2, $fails)))
}
Remove-Item -Force (Join-Path $dir 'agent.pid') -ErrorAction SilentlyContinue
'@
  $runPs1 = $runPs1.Replace('__DIR__', $InstallDir.Replace("'", "''")).Replace('__NODE__', $node.Replace("'", "''")).Replace('__PATH__', $env:PATH.Replace("'", "''"))
  Set-Content -Path (Join-Path $InstallDir 'run.ps1') -Value $runPs1 -Encoding UTF8

  Write-Host '> Checking connection and local CLIs' -ForegroundColor Green
  & $node (Join-Path $InstallDir 'agent.mjs') doctor
  if ($LASTEXITCODE -ne 0) { throw 'The agent could not connect. Check the token/host and re-run the installer.' }

  if (-not $NoAutostart) {
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'run.ps1')`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
      -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $script:AutoSEOTaskName -Action $action -Trigger $trigger -Settings $taskSettings -Principal $principal `
      -Description 'AutoSEO local agent (Claude Code / Codex). Outbound HTTPS only.' -Force | Out-Null
    Start-ScheduledTask -TaskName $script:AutoSEOTaskName
    Write-Host "> Autostart: Scheduled Task '$($script:AutoSEOTaskName)' (at logon, restarts on failure)" -ForegroundColor Green
  } else {
    Write-Host "> Autostart skipped. Start the agent with: powershell -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'run.ps1')`"" -ForegroundColor Yellow
  }

  Write-Host ''
  Write-Host "AutoSEO agent $version installed. It shows up as online in your dashboard within a few seconds." -ForegroundColor Green
  Write-Host "  Logs:      Get-Content -Wait `"$(Join-Path $InstallDir 'logs\agent.log')`""
  Write-Host "  Uninstall: iwr -useb $HostUrl/install.ps1 | iex; Uninstall-AutoSEOAgent"
}

function Uninstall-AutoSEOAgent {
  [CmdletBinding()]
  param([string]$InstallDir = (Join-Path $env:USERPROFILE '.autoseo-agent'))
  $ErrorActionPreference = 'Stop'
  Write-Host "> Uninstalling the AutoSEO agent from $InstallDir" -ForegroundColor Green
  Stop-AutoSEOAgentProcess -InstallDir $InstallDir
  if (Get-ScheduledTask -TaskName $script:AutoSEOTaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $script:AutoSEOTaskName -Confirm:$false
  }
  if ((Test-Path $InstallDir) -and ($InstallDir -like '*autoseo-agent*')) { Remove-Item -Recurse -Force $InstallDir }
  Write-Host '> Done. Delete the agent in the AutoSEO dashboard to revoke its token.' -ForegroundColor Green
}
