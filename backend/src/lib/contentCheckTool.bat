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
rem downloads the race server's list of files and hashes, compares your own
rem copies and prints what differs, what is missing and what to do about it.
rem ---------------------------------------------------------------------------
title NABS Content Check
set "NABS_SELF=%~f0"
set "NABS_ARG=%~1"
powershell.exe -NoProfile -Command "& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:NABS_SELF)))"
if errorlevel 1 pause
exit /b
#>

# ---------------------------------------------------------------------------
# NABS Content Check - finds what on your PC differs from the race server.
#
# The site reads the race server's own content folder and hands over the
# list (/api/content-check/full): every file the server holds for tonight's
# cars and track with the MD5 of ITS copy, the 3D models and liveries that
# must exist, and the folders that must NOT exist. This script compares that
# list with your Assetto Corsa folder and says, per car and per track, what
# differs, what is missing, and what each difference does:
#
#   KICK     the server checks it when you join: "Checksum failed"
#   PROBLEM  you can join, but the race is different for you (DRS zones, pit
#            lane) or the game crashes (a missing 3D model)
#   LOOKS    only looks (a livery you don't have)
#
# Plus your own setup: Custom Shaders Patch and Real Penalty.
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
  $url = "$Site/api/content-check/full"
  if ($ServerKey) { $url += "?server=$([uri]::EscapeDataString($ServerKey))" }
  try {
    return Invoke-RestMethod -Uri $url -UseBasicParsing -TimeoutSec 180 -Headers @{ Accept = 'application/json' }
  } catch {
    throw "Could not get the race server's file list from $Site. $(Get-ApiError $_)"
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

# --- Your own setup -----------------------------------------------------------

# Custom Shaders Patch: dwrite.dll in the AC folder is what loads it, and its
# data_manifest.ini names the version.
function Get-CspInfo([string]$Ac) {
  if (-not (Test-Path -LiteralPath (Join-Path $Ac 'dwrite.dll') -PathType Leaf)) { return $null }
  $info = 'installed, version unknown'
  $manifest = Join-Path $Ac 'extension\config\data_manifest.ini'
  if (Test-Path -LiteralPath $manifest -PathType Leaf) {
    $text = Get-Content -LiteralPath $manifest -Raw
    $ver = [regex]::Match($text, '(?m)^\s*SHADERS_PATCH\s*=\s*(\S+)')
    $build = [regex]::Match($text, '(?m)^\s*SHADERS_PATCH_BUILD\s*=\s*(\d+)')
    if ($ver.Success) {
      $info = $ver.Groups[1].Value
      if ($build.Success) { $info += " (build $($build.Groups[1].Value))" }
    }
  }
  return $info
}

# Real Penalty: whatever app folder carries the name, Python or Lua.
function Get-RealPenalty([string]$Ac) {
  $found = @()
  foreach ($sub in 'apps\python', 'apps\lua') {
    $dir = Join-Path $Ac $sub
    if (Test-Path -LiteralPath $dir -PathType Container) {
      foreach ($d in Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue) {
        if ($d.Name -match 'penalty') { $found += "$sub\$($d.Name)" }
      }
    }
  }
  return $found
}

# --- Comparing ------------------------------------------------------------------

$Levels = @{
  kick     = @{ Label = 'KICK   '; Color = 'Red' }
  problem  = @{ Label = 'PROBLEM'; Color = 'Yellow' }
  cosmetic = @{ Label = 'LOOKS  '; Color = 'DarkGray' }
}

# One finding: the line on screen and the line for Discord.
function New-Finding($Entry, [string]$Kind, [string]$Detail = '') {
  $level = "$($Entry.level)"
  if (-not $Levels.ContainsKey($level)) { $level = 'problem' }
  return [pscustomobject]@{
    Group  = "$($Entry.group)"
    Level  = $level
    Kind   = $Kind
    Path   = ($Entry.path -replace '/', '\')
    What   = "$($Entry.what)"
    Detail = $Detail
  }
}

# The folder a fix starts from: content\cars\<car> or content\tracks\<track>.
function Get-GroupFolder([string]$Path) {
  $parts = $Path -split '\\'
  if ($parts.Count -ge 3) { return ($parts[0..2] -join '\') }
  return $Path
}

# "car formula_2010" -> "CAR formula_2010": the kind loud, the name as it is
# spelled on disk.
function Format-Group([string]$G) {
  $parts = $G.Split(' ', 2)
  if ($parts.Count -lt 2) { return $G.ToUpper() }
  return "$($parts[0].ToUpper()) $($parts[1])"
}

function Write-Finding($F) {
  $lv = $Levels[$F.Level]
  Say "    $($lv.Label)  $($F.Kind.PadRight(13)) $($F.Path)" $lv.Color
  if ($F.What) { Say "                            $($F.What)" 'DarkGray' }
  if ($F.Detail) { Say "                            $($F.Detail)" 'DarkGray' }
}

# Whose install a car or track was also compared with, or why not.
function Write-ReferenceLine($Data, [string]$Group) {
  foreach ($r in @($Data.references)) {
    if ("$($r.group)" -ne $Group) { continue }
    $when = ''
    try { $when = ([datetime]$r.at).ToString('yyyy-MM-dd') } catch {}
    if ($r.stale) {
      Say "    (The reference install of $($r.by) from $when is out of date: the server has a newer version. Admins: save it again.)" 'Yellow'
    } else {
      Say "    Also compared with the reference install of $($r.by) ($when): 3D models and liveries included." 'DarkGray'
    }
  }
}

function Format-Size($Bytes) {
  $b = [double]$Bytes
  if ($b -ge 1MB) { return ('{0:N1} MB' -f ($b / 1MB)) }
  if ($b -ge 1KB) { return ('{0:N0} KB' -f ($b / 1KB)) }
  return "$([int64]$b) bytes"
}

# The site's own error message out of a failed request, if it sent one.
function Get-ApiError($Err) {
  $msg = $Err.Exception.Message
  try {
    $body = $Err.ErrorDetails.Message | ConvertFrom-Json
    if ($body.error) { $msg = $body.error }
  } catch {}
  return $msg
}

function ConvertTo-JsonText([string]$Text) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $Text.ToCharArray()) {
    $code = [int]$ch
    if ($ch -eq '"') { [void]$sb.Append('\"') }
    elseif ($ch -eq '\') { [void]$sb.Append('\\') }
    elseif ($code -lt 32) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

# --- Saving this install as the reference (admins) -----------------------------
#
# Hashes the session's car and track folders on THIS PC and sends the list -
# paths, sizes and checksums, never the files - to the site. The site only
# takes it when everything the server itself holds matches, and from then on
# every driver's check compares against it too.

function Save-Reference([string]$Ac, $Data) {
  Say
  Say '  SAVE THIS INSTALL AS THE REFERENCE' 'White'
  Say '  Only do this when the cars and the track work for you on the server.' 'DarkGray'
  # Hidden while typing; a piped-in answer (scripted runs) cannot be read that way.
  if ([Console]::IsInputRedirected) {
    $pin = Read-Host '  Admin PIN'
  } else {
    $secure = Read-Host '  Admin PIN' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $pin = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  $by = Read-Host "  Your name, shown with the reference (Enter = $env:USERNAME)"
  if (-not "$by".Trim()) { $by = "$env:USERNAME" }
  try {
    $login = Invoke-RestMethod -Uri "$Site/api/admin/login" -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{ pin = $pin }) -UseBasicParsing -TimeoutSec 60
  } catch {
    Say "  Not saved: $(Get-ApiError $_)" 'Red'
    return
  }

  # What belongs to the session: its cars with the liveries on the grid, and
  # its track (every layout; the site picks the one in play).
  $groups = @()
  foreach ($f in @($Data.files)) {
    if ($f.source -eq 'reference') { continue }
    $m = [regex]::Match("$($f.path)", '^content/cars/([^/]+)/data\.acd$')
    if ($m.Success) { $groups += @{ kind = 'car'; name = $m.Groups[1].Value } }
  }
  if ($Data.track) { $groups += @{ kind = 'track'; name = "$($Data.track)" } }
  $skins = @{}
  foreach ($p in @($Data.present)) {
    $m = [regex]::Match("$($p.path)", '^content/cars/([^/]+)/skins/([^/]+)$')
    if ($m.Success) { $skins["$($m.Groups[1].Value)/$($m.Groups[2].Value)".ToLower()] = $true }
  }

  $json = New-Object System.Text.StringBuilder
  [void]$json.Append('{"server":' + (ConvertTo-JsonText "$($Data.server.key)") + ',"by":' + (ConvertTo-JsonText $by) + ',"groups":[')
  $firstGroup = $true
  foreach ($g in $groups) {
    $sub = 'cars'
    if ($g.kind -eq 'track') { $sub = 'tracks' }
    $root = Join-Path $Ac "content\$sub\$($g.name)"
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { Say "  skipped $($g.kind) $($g.name): not installed here" 'Yellow'; continue }
    $rootFull = (Get-Item -LiteralPath $root).FullName.TrimEnd('\', '/')
    $files = @(Get-ChildItem -LiteralPath $rootFull -Recurse -File -Force -ErrorAction SilentlyContinue)
    $entries = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $files.Count; $i++) {
      $file = $files[$i]
      $rel = $file.FullName.Substring($rootFull.Length + 1) -replace '\\', '/'
      $parts = $rel.ToLower().Split('/')
      if ($parts[0] -eq 'ui') { continue }
      if ($g.kind -eq 'car') {
        if ($parts[0] -eq 'data') { continue }
        if ($parts[0] -eq 'skins' -and ($parts.Count -lt 3 -or -not $skins["$($g.name)/$($parts[1])".ToLower()])) { continue }
      }
      Write-Progress -Activity "Hashing $($g.kind) $($g.name)" -Status $rel -PercentComplete ([int](100 * $i / [Math]::Max(1, $files.Count)))
      [void]$entries.Add('{"p":' + (ConvertTo-JsonText $rel) + ',"s":' + $file.Length + ',"m":"' + (Get-Md5 $file.FullName) + '"}')
    }
    Write-Progress -Activity "Hashing $($g.kind) $($g.name)" -Completed
    if ($entries.Count -eq 0) { continue }
    if (-not $firstGroup) { [void]$json.Append(',') }
    $firstGroup = $false
    [void]$json.Append('{"kind":"' + $g.kind + '","name":' + (ConvertTo-JsonText $g.name) + ',"files":[' + ($entries -join ',') + ']}')
    Say "  hashed $($g.kind) $($g.name): $($entries.Count) files" 'DarkGray'
  }
  [void]$json.Append(']}')

  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($json.ToString())
    $res = Invoke-RestMethod -Uri "$Site/api/content-check/reference" -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -Headers @{ Authorization = "Bearer $($login.token)" } -UseBasicParsing -TimeoutSec 300
    Say
    foreach ($s in @($res.saved)) { Say "  SAVED: $($s.kind) $($s.name) ($($s.files) files)" 'Green' }
    Say '  From now on every check also compares against this install.' 'DarkGray'
  } catch {
    Say "  Not saved: $(Get-ApiError $_)" 'Red'
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
  Say '  Reading the race server ...' 'DarkGray'

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
      Say '  Reading the race server ...' 'DarkGray'
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
  $when = ''
  if ($data.session.date) { $when = " - session of $(([datetime]$data.session.date).ToString('yyyy-MM-dd'))" }
  Say "  $($data.server.name) - $trackLine$when" 'White'

  $findings = New-Object System.Collections.ArrayList
  $checked = @{}   # group -> how many things were checked
  $skipped = 0

  # 1. Files with a known checksum - the server's own, or a reference
  #    install's (an admin's install that matches the server, which also
  #    covers the 3D models and liveries the server does not hand out).
  #    Yours must be byte-identical. A different size settles it without
  #    reading the file.
  $allFiles = @($data.files)
  for ($i = 0; $i -lt $allFiles.Count; $i++) {
    $f = $allFiles[$i]
    if (-not (Test-SafePath $f.path)) { continue }
    if (-not $f.md5) { $skipped++; continue }
    $checked[$f.group] = 1 + [int]$checked[$f.group]
    $source = 'server'
    if ($f.source -eq 'reference') { $source = 'reference' }
    $local = Join-Path $ac ($f.path -replace '/', '\')
    Write-Progress -Activity 'Comparing your files' -Status $f.path -PercentComplete ([int](100 * $i / [Math]::Max(1, $allFiles.Count)))
    if (-not (Test-Path -LiteralPath $local -PathType Leaf)) {
      [void]$findings.Add((New-Finding $f 'MISSING'))
      continue
    }
    $item = Get-Item -LiteralPath $local
    $date = $item.LastWriteTime.ToString('yyyy-MM-dd')
    if ($null -ne $f.size -and [int64]$item.Length -ne [int64]$f.size) {
      [void]$findings.Add((New-Finding $f 'WRONG VERSION' "yours $(Format-Size $item.Length) (from $date), $source $(Format-Size $f.size)"))
      continue
    }
    $hash = Get-Md5 $local
    if ($hash -ne $f.md5) {
      [void]$findings.Add((New-Finding $f 'WRONG VERSION' "yours $($hash.Substring(0, 8)) (from $date), $source $($f.md5.Substring(0, 8))"))
    }
  }
  Write-Progress -Activity 'Comparing your files' -Completed

  # 2. Things that must exist: models, liveries, the car and layout folders.
  $missingDirs = @()
  foreach ($p in @($data.present)) {
    if (-not (Test-SafePath $p.path)) { continue }
    $checked[$p.group] = 1 + [int]$checked[$p.group]
    $local = Join-Path $ac ($p.path -replace '/', '\')
    if ($p.type -eq 'anyKn5') {
      if (-not (Test-Path -LiteralPath $local -PathType Container)) {
        # Not a missing model: the whole car is missing, and that is a kick.
        $missingCar = [pscustomobject]@{ group = $p.group; level = 'kick'; path = $p.path; what = 'the car is not installed at all.' }
        [void]$findings.Add((New-Finding $missingCar 'NOT INSTALLED'))
      } elseif (-not (Get-ChildItem -LiteralPath $local -Filter '*.kn5' -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        [void]$findings.Add((New-Finding $p 'NO 3D MODEL'))
      }
    } elseif ($p.type -eq 'dir') {
      if (-not (Test-Path -LiteralPath $local -PathType Container)) {
        if ($p.level -eq 'kick') {
          # The layout folder is missing. Is the whole track?
          $root = Get-GroupFolder ($p.path -replace '/', '\')
          if (-not (Test-Path -LiteralPath (Join-Path $ac $root) -PathType Container)) {
            $p = [pscustomobject]@{ group = $p.group; level = 'kick'; path = $root; what = 'the track is not installed at all.' }
          }
          [void]$findings.Add((New-Finding $p 'NOT INSTALLED'))
        } else {
          [void]$findings.Add((New-Finding $p 'MISSING'))
          $missingDirs += ($p.path -replace '/', '\')
        }
      }
    } else {
      if (-not (Test-Path -LiteralPath $local -PathType Leaf)) { [void]$findings.Add((New-Finding $p 'MISSING')) }
    }
  }

  # 3. Things that must NOT exist: an unpacked data folder beside the .acd.
  foreach ($a in @($data.absent)) {
    if (-not (Test-SafePath $a.path)) { continue }
    $checked[$a.group] = 1 + [int]$checked[$a.group]
    if (Test-Path -LiteralPath (Join-Path $ac ($a.path -replace '/', '\')) -PathType Container) {
      [void]$findings.Add((New-Finding $a 'DELETE THIS'))
    }
  }

  # A missing car, track or layout folder makes every line under it say
  # "missing": one line saying so is the answer, the rest is noise.
  $goneRoots = @($findings | Where-Object { $_.Kind -eq 'NOT INSTALLED' } | ForEach-Object { $_.Path }) + $missingDirs
  if ($goneRoots.Count) {
    $kept = @($findings | Where-Object {
      $cand = $_
      -not ($goneRoots | Where-Object { $cand.Path -ne $_ -and $cand.Path.StartsWith("$_\", [StringComparison]::OrdinalIgnoreCase) })
    })
    $findings = New-Object System.Collections.ArrayList
    foreach ($k in $kept) { [void]$findings.Add($k) }
  }

  # --- What came out, per car and per track ---
  $report = New-Object System.Collections.ArrayList
  [void]$report.Add("NABS Content Check (Windows tool) - $($data.server.name) - $trackLine")
  $groups = @(@($data.files) + @($data.present) + @($data.absent) | ForEach-Object { "$($_.group)" } | Where-Object { $_ } | Select-Object -Unique)
  foreach ($g in $groups) {
    Say
    $mine = @($findings | Where-Object { $_.Group -eq $g })
    $serious = @($mine | Where-Object { $_.Level -ne 'cosmetic' })
    $looks = @($mine | Where-Object { $_.Level -eq 'cosmetic' })
    if ($mine.Count -eq 0) {
      Say "  $(Format-Group $g)   all good ($([int]$checked[$g]) checked)" 'Green'
      Write-ReferenceLine $data $g
      continue
    }
    Say "  $(Format-Group $g)" 'White'
    Write-ReferenceLine $data $g
    foreach ($f in $serious) {
      Write-Finding $f
      $line = "$($f.Level.ToUpper()) $($f.Kind): $($f.Path)"
      if ($f.Detail) { $line += " ($($f.Detail))" }
      [void]$report.Add($line)
    }
    # Missing liveries can run into dozens: one line with their names.
    if ($looks.Count -gt 3 -and @($looks | Where-Object { $_.Path -match '\\skins\\' }).Count -eq $looks.Count) {
      $all = @($looks | ForEach-Object { Split-Path $_.Path -Leaf })
      $names = ($all | Select-Object -First 8) -join ', '
      if ($all.Count -gt 8) { $names += ", and $($all.Count - 8) more" }
      Say "    LOOKS    $($looks.Count) liveries missing: $names" 'DarkGray'
      Say '                            you see those cars in another livery.' 'DarkGray'
      [void]$report.Add("LOOKS: $($looks.Count) liveries missing ($names)")
    } else {
      foreach ($f in $looks) {
        Write-Finding $f
        [void]$report.Add("LOOKS $($f.Kind): $($f.Path)")
      }
    }
    # What to do about it.
    $folder = Get-GroupFolder $mine[0].Path
    $onlyUnpacked = $serious.Count -gt 0 -and @($serious | Where-Object { $_.Kind -ne 'DELETE THIS' }).Count -eq 0
    if (@($serious | Where-Object { $_.Kind -eq 'NOT INSTALLED' }).Count) {
      Say "    -> Install it from the NABS Google Drive." 'Cyan'
    } elseif ($onlyUnpacked) {
      Say "    -> Delete the folder marked DELETE THIS. Nothing needs reinstalling." 'Cyan'
    } elseif ($serious.Count -gt 0) {
      Say "    -> Delete $folder completely, then install it fresh from the NABS Google Drive." 'Cyan'
    } else {
      Say '    -> Optional: get the skin pack from the NABS Google Drive.' 'Cyan'
    }
  }

  # --- Your setup ---
  Say
  Say '  YOUR SETUP' 'White'
  $csp = Get-CspInfo $ac
  if ($csp) {
    Say "    ok       Custom Shaders Patch  $csp" 'DarkGreen'
    [void]$report.Add("CSP: $csp")
  } else {
    $f = [pscustomobject]@{ group = 'setup'; level = 'problem'; path = 'dwrite.dll'; what = 'Custom Shaders Patch is not installed. The NABS tracks need it: get it from the NABS Google Drive.' }
    [void]$findings.Add((New-Finding $f 'MISSING'))
    Write-Finding $findings[$findings.Count - 1]
    [void]$report.Add('PROBLEM: Custom Shaders Patch not installed')
  }
  $rp = @(Get-RealPenalty $ac)
  if ($rp.Count) {
    Say "    ok       Real Penalty          $($rp -join ', ')" 'DarkGreen'
  } else {
    $f = [pscustomobject]@{ group = 'setup'; level = 'kick'; path = 'apps\python\RealPenalty'; what = 'Real Penalty not found. It is mandatory: the server removes you without it. Get it from the NABS Google Drive.' }
    [void]$findings.Add((New-Finding $f 'MISSING'))
    Write-Finding $findings[$findings.Count - 1]
    [void]$report.Add('KICK: Real Penalty not found')
  }

  # --- Verdict ---
  $kicks = @($findings | Where-Object { $_.Level -eq 'kick' }).Count
  $problems = @($findings | Where-Object { $_.Level -eq 'problem' }).Count
  $cosmetic = @($findings | Where-Object { $_.Level -eq 'cosmetic' }).Count
  Say
  if ($kicks + $problems -eq 0) {
    Say '  EVERYTHING MATCHES THE SERVER.' 'Green'
    if ($cosmetic) { Say "  Only $cosmetic thing(s) that change how something looks." 'DarkGray' }
    Say "  If you still can't join, it isn't your files. Post a screenshot of the error in the Discord." 'DarkGray'
    [void]$report.Add('Everything matches the server.')
  } else {
    $parts = @()
    if ($kicks) { $parts += "$kicks that get you kicked" }
    if ($problems) { $parts += "$problems problem(s)" }
    if ($cosmetic) { $parts += "$cosmetic only looks" }
    $color = 'Yellow'
    if ($kicks) { $color = 'Red' }
    Say "  FOUND: $($parts -join ', ')." $color
    if ($kicks) { Say '  Fix the KICK lines first, then run this again.' 'Gray' } else { Say '  Fix the PROBLEM lines, then run this again.' 'Gray' }
  }
  if ($skipped -gt 0) { Say "  $skipped file(s) the server could not hand out were not compared." 'DarkGray' }
  # The server never hands out the 3D models: only a reference install can
  # say whether they are the right ones.
  $withRef = @(@($data.references) | Where-Object { $_ -and -not $_.stale } | ForEach-Object { "$($_.group)" })
  $noRef = @($groups | Where-Object { $withRef -notcontains $_ })
  if ($noRef.Count) {
    Say "  No reference install yet for: $($noRef -join ', '). Their 3D models were only checked for being there." 'DarkGray'
  }

  # What a driver pastes into Discord, so the answer there is a file name.
  try {
    Set-Clipboard -Value ($report -join "`r`n")
    Say
    Say '  The result is copied: paste it into the Discord with Ctrl+V.' 'Cyan'
  } catch {}

  # A clean install can become the reference for everyone else.
  if ($kicks + $problems -eq 0) {
    Say
    $answer = Read-Host '  Press Enter to close (admins: R and Enter saves this install as the reference)'
    if ("$answer".Trim() -match '^[rR]$') {
      Save-Reference $ac $data
      Finish
    }
    exit 0
  }
  Finish
} catch {
  Say
  Say "  Something went wrong: $($_.Exception.Message)" 'Red'
  Say "  The check on the website does part of this: $Site/content-check" 'Gray'
  Finish
}
