<# : NABS Content Check for Windows. Double-click to run.
@echo off
setlocal
rem ---------------------------------------------------------------------------
rem This file is two scripts in one. cmd.exe runs these few lines and hands
rem the WHOLE file to PowerShell, which reads everything up to the line that
rem closes the comment as a comment and runs the rest. One .bat file, so a
rem driver only has to double-click it - a .ps1 would open in Notepad.
rem
rem It only READS your files. Nothing is changed, deleted or uploaded: it
rem downloads the race server's list of file hashes, hashes your own copies
rem and prints which ones differ.
rem ---------------------------------------------------------------------------
title NABS Content Check
set "NABS_SELF=%~f0"
set "NABS_ARG=%~1"
powershell.exe -NoProfile -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:NABS_SELF)))"
if errorlevel 1 pause
exit /b
#>

# ---------------------------------------------------------------------------
# NABS Content Check - the same comparison as the /content-check page on the
# website, without a browser: the race server names the files it checksums
# (each car's data.acd, the track's surfaces.ini) with the MD5 of ITS copy,
# and this script hashes yours and names the ones that differ. That is the
# comparison Assetto Corsa makes when you join, and one mismatch is the
# "Checksum failed" kick.
#
# Written for the Windows PowerShell 5.1 every Windows 10/11 PC ships with.
# ---------------------------------------------------------------------------

$Site = '__NABS_SITE__'
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 still offers TLS 1.0 first; the site only speaks 1.2+.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

function Say([string]$Text = '', [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }

# Always exit 0 once the driver has read the result: a non-zero exit is the
# .bat's signal that PowerShell itself fell over, and it pauses on that.
function Finish {
  Say
  Read-Host 'Press Enter to close' | Out-Null
  exit 0
}

# --- Finding the Assetto Corsa folder ----------------------------------------

# A folder counts as an AC install when it has content\cars in it. A driver may
# hand us the assettocorsa folder or the content folder itself; both work.
function Resolve-AcRoot([string]$Path) {
  if (-not $Path) { return $null }
  $Path = $Path.Trim().Trim('"').TrimEnd('\', '/')
  if (-not $Path) { return $null }
  if (Test-Path -LiteralPath (Join-Path $Path 'content\cars') -PathType Container) { return $Path }
  if ((Split-Path $Path -Leaf) -eq 'content' -and (Test-Path -LiteralPath (Join-Path $Path 'cars') -PathType Container)) {
    return (Split-Path $Path -Parent)
  }
  return $null
}

# Every Steam library on this PC: Steam's own folder plus whatever
# libraryfolders.vdf lists (games on a second drive live there).
function Get-SteamLibraries {
  $roots = @()
  foreach ($key in 'HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam') {
    try {
      $p = Get-ItemProperty -Path $key -ErrorAction Stop
      if ($p.SteamPath) { $roots += ($p.SteamPath -replace '/', '\') }
      if ($p.InstallPath) { $roots += $p.InstallPath }
    } catch {}
  }
  $roots += "${env:ProgramFiles(x86)}\Steam"
  $libs = @()
  foreach ($root in ($roots | Select-Object -Unique)) {
    if (-not $root) { continue }
    $libs += $root
    $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
    if (Test-Path -LiteralPath $vdf) {
      foreach ($m in [regex]::Matches((Get-Content -LiteralPath $vdf -Raw), '"path"\s+"([^"]+)"')) {
        $libs += ($m.Groups[1].Value -replace '\\\\', '\')
      }
    }
  }
  return $libs | Where-Object { $_ } | Select-Object -Unique
}

function Find-AcRoot {
  # 1. A folder dropped onto the .bat.
  $hit = Resolve-AcRoot $env:NABS_ARG
  if ($hit) { return $hit }
  if ($env:NABS_ARG) { Say "  '$($env:NABS_ARG)' is not an Assetto Corsa folder, looking elsewhere." 'Yellow' }
  # 2. The tool sitting inside the AC folder (or one of its subfolders).
  if ($env:NABS_SELF) {
    $dir = Split-Path $env:NABS_SELF -Parent
    while ($dir) {
      $hit = Resolve-AcRoot $dir
      if ($hit) { return $hit }
      $parent = Split-Path $dir -Parent
      if ($parent -eq $dir) { break }
      $dir = $parent
    }
  }
  # 3. Steam.
  foreach ($lib in Get-SteamLibraries) {
    $hit = Resolve-AcRoot (Join-Path $lib 'steamapps\common\assettocorsa')
    if ($hit) { return $hit }
  }
  # 4. Ask.
  Say '  Could not find Assetto Corsa by itself.' 'Yellow'
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Pick your assettocorsa folder'
    $dlg.ShowNewFolderButton = $false
    if ($dlg.ShowDialog() -eq 'OK') {
      $hit = Resolve-AcRoot $dlg.SelectedPath
      if ($hit) { return $hit }
      Say "  '$($dlg.SelectedPath)' has no content\cars folder." 'Yellow'
    }
  } catch {}
  $typed = Read-Host '  Paste the path of your assettocorsa folder'
  return (Resolve-AcRoot $typed)
}

# --- The race server's list --------------------------------------------------

function Get-Manifest([string]$ServerKey) {
  $url = "$Site/api/content-check"
  if ($ServerKey) { $url += "?server=$([uri]::EscapeDataString($ServerKey))" }
  try {
    return Invoke-RestMethod -Uri $url -UseBasicParsing -TimeoutSec 90 -Headers @{ Accept = 'application/json' }
  } catch {
    $msg = $_.Exception.Message
    try {
      $body = $_.ErrorDetails.Message | ConvertFrom-Json
      if ($body.error) { $msg = $body.error }
    } catch {}
    throw "Could not get the race server's file list from $Site. $msg"
  }
}

# Only paths of the shape the site hands out: content\... with no way out of
# the AC folder. The script only ever reads, but it reads only what it should.
function Test-SafePath([string]$Rel) {
  return ($Rel -match '^content/' -and $Rel -notmatch '(^|/)\.\.(/|$)' -and $Rel -notmatch '[:\\]')
}

function Get-Md5([string]$File) {
  $md5 = [Security.Cryptography.MD5]::Create()
  # The provider's own full path: .NET resolves relative paths against a
  # different current folder than PowerShell does.
  $stream = [IO.File]::OpenRead((Get-Item -LiteralPath $File).FullName)
  try {
    return (($md5.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $stream.Dispose()
    $md5.Dispose()
  }
}

# --- Main --------------------------------------------------------------------

try {
  Say
  Say '  NABS CONTENT CHECK' 'Cyan'
  Say '  Compares your Assetto Corsa files with the race server. Reads only, changes nothing.' 'DarkGray'
  Say

  $ac = Find-AcRoot
  if (-not $ac) {
    Say '  No Assetto Corsa folder, nothing to check.' 'Red'
    Finish
  }
  Say "  Assetto Corsa: $ac" 'DarkGray'

  $data = Get-Manifest $null
  $servers = @($data.servers)
  if ($servers.Count -gt 1) {
    Say
    Say '  Which server do you want to join?'
    for ($i = 0; $i -lt $servers.Count; $i++) {
      $mark = ''
      if ($servers[$i].key -eq $data.server.key) { $mark = '  (Enter)' }
      Say "    [$($i + 1)] $($servers[$i].name)$mark"
    }
    $pick = Read-Host '  Number'
    $n = 0
    if ([int]::TryParse("$pick".Trim(), [ref]$n) -and $n -ge 1 -and $n -le $servers.Count -and $servers[$n - 1].key -ne $data.server.key) {
      $data = Get-Manifest $servers[$n - 1].key
    }
  }

  Say
  if (-not $data.session) {
    $note = 'This server has no session yet to read a car list from.'
    if ($data.note) { $note = $data.note }
    Say "  $($data.server.name): $note" 'Yellow'
    Finish
  }
  $trackLine = $data.track
  if ($data.config) { $trackLine += " ($($data.config))" }
  Say "  $($data.server.name) - $trackLine" 'White'
  Say

  # The manifest also carries a layout track's root surfaces.ini for the admin
  # view; the game never checks it for a layout session, so neither do we.
  $files = @($data.files | Where-Object { $_.inPlay -ne $false })
  $problems = @()
  $okCount = 0
  $skipped = 0

  foreach ($f in $files) {
    if (-not (Test-SafePath $f.path)) { continue }
    if (-not $f.md5) { $skipped++; continue }
    $shown = $f.path -replace '/', '\'
    $local = Join-Path $ac $shown
    if (-not (Test-Path -LiteralPath $local -PathType Leaf)) {
      Say "  MISSING        $shown" 'Red'
      $problems += "MISSING: $shown"
    } else {
      $hash = Get-Md5 $local
      if ($hash -eq $f.md5) {
        Say "  ok             $shown" 'DarkGreen'
        $okCount++
      } else {
        $when = (Get-Item -LiteralPath $local).LastWriteTime.ToString('yyyy-MM-dd')
        Say "  WRONG VERSION  $shown" 'Red'
        Say "                 yours $($hash.Substring(0, 8)) (from $when), server $($f.md5.Substring(0, 8))" 'DarkGray'
        $problems += "WRONG VERSION: $shown (yours $($hash.Substring(0, 8)), server $($f.md5.Substring(0, 8)))"
      }
    }
    # An unpacked data\ folder beside the .acd is read INSTEAD of the .acd, so
    # the hash can be perfect and the join still fail.
    if ($f.unpackedDir -and (Test-SafePath $f.unpackedDir)) {
      $shownDir = $f.unpackedDir -replace '/', '\'
      if (Test-Path -LiteralPath (Join-Path $ac $shownDir) -PathType Container) {
        Say "  UNPACKED DATA  $shownDir" 'Yellow'
        Say '                 delete this folder, it overrides the data.acd' 'DarkGray'
        $problems += "UNPACKED DATA: $shownDir (overrides the data.acd)"
      }
    }
  }

  Say
  if ($problems.Count -eq 0) {
    Say "  ALL FILES MATCH ($okCount checked)." 'Green'
    Say "  If you still get kicked, it isn't these files. Post a screenshot of the error in the Discord." 'DarkGray'
    $report = @("NABS Content Check (Windows tool) - $($data.server.name) - $trackLine", "All files match ($okCount checked).")
  } else {
    $word = 'problems'
    if ($problems.Count -eq 1) { $word = 'problem' }
    Say "  $($problems.Count) $word FOUND." 'Red'
    Say '  Delete that car or track folder, install it fresh from the NABS Google Drive and run this again.' 'Gray'
    $report = @("NABS Content Check (Windows tool) - $($data.server.name) - $trackLine") + $problems
  }
  if ($skipped -gt 0) { Say "  $skipped file(s) the server has no hash for could not be compared." 'DarkGray' }

  # What a driver pastes into Discord, so the answer there is a file name.
  try {
    Set-Clipboard -Value ($report -join "`r`n")
    Say
    Say '  The result is copied: paste it into the Discord with Ctrl+V.' 'Cyan'
  } catch {}
  Finish
} catch {
  Say
  Say "  Something went wrong: $($_.Exception.Message)" 'Red'
  Say "  The check on the website does the same thing: $Site/content-check" 'Gray'
  Finish
}
