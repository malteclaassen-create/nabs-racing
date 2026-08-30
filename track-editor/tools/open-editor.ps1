# Startet den Editor und oeffnet die Seite im Standardbrowser.
# Laeuft der Dev-Server schon, wird nur der Browser aufgemacht -- ein zweiter
# Vite-Prozess wuerde sonst auf einen anderen Port ausweichen (strictPort: false)
# und die offene Sitzung waere nicht die, die man sieht.
param(
  [int]$Port = 5199,
  [switch]$Profiling,   # nimmt vite.config.profiling.ts auf Port 5299 (js-profiling)
  [switch]$NoBrowser,
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($Profiling -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = 5299 }
# Mit dem Unterpfad, nicht blank auf "/": seit der Editor auch auf der
# Liga-Seite unter /track-editor laeuft, steht in vite.config.ts ein `base`.
# Der Dev-Server liefert die Seite dann NUR unter diesem Pfad aus, und "/"
# antwortet mit Vites Hinweisseite statt mit dem Editor.
$url = "http://localhost:$Port/track-editor/"

# Vite bindet unter Windows nur ::1, nicht 127.0.0.1. Ein blanker TcpClient ist
# IPv4-only und kann ::1 gar nicht erreichen -- er wuerde den laufenden Server
# fuer tot halten und ins Timeout warten. Eine HTTP-Anfrage gegen "localhost"
# nimmt beide Adressfamilien und beweist nebenbei, dass die Seite antwortet.
function Test-Server([int]$p) {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://localhost:$p/")
    $req.Timeout = 2000
    $req.Proxy = $null           # sonst laeuft localhost ueber einen Firmen-Proxy
    $req.Method = 'HEAD'
    $req.GetResponse().Close()
    return $true
  } catch [System.Net.WebException] {
    # Statuscode egal -- wer antwortet, lebt.
    return ($null -ne $_.Exception.Response)
  } catch {
    return $false
  }
}

if (Test-Server $Port) {
  Write-Host "Dev-Server laeuft bereits auf Port $Port." -ForegroundColor Green
} else {
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "node_modules fehlt -- npm install laeuft (das dauert einmalig)..." -ForegroundColor Yellow
    Push-Location $root
    try { & npm install } finally { Pop-Location }
  }

  if ($Profiling) {
    $cmd = 'npx vite --config vite.config.profiling.ts'
    $title = "ac-track-editor profiling $Port"
  } else {
    # Ohne abweichenden Port den Port nicht anhaengen -- npm run dev setzt ihn
    # schon, sonst steht --port zweimal in der Kommandozeile.
    $cmd = if ($Port -eq 5199) { 'npm run dev' } else { "npm run dev -- --port $Port" }
    $title = "ac-track-editor $Port"
  }

  Write-Host "Starte Dev-Server: $cmd" -ForegroundColor Cyan
  # Eigenes, minimiertes Fenster: der Server ueberlebt das Schliessen dieses
  # Starters, und die Vite-Logs bleiben trotzdem nachlesbar.
  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "title $title && $cmd" `
    -WorkingDirectory $root -WindowStyle Minimized

  $deadline = $TimeoutSeconds * 4
  $ready = $false
  for ($i = 0; $i -lt $deadline; $i++) {
    if (Test-Server $Port) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }

  if (-not $ready) {
    Write-Host "Port $Port ist nach $TimeoutSeconds s immer noch zu." -ForegroundColor Red
    Write-Host "Schau ins minimierte Fenster '$title' -- dort steht der Fehler." -ForegroundColor Red
    exit 1
  }
  Write-Host "Server ist da." -ForegroundColor Green
}

if ($NoBrowser) {
  Write-Host $url
} else {
  Write-Host "Oeffne $url" -ForegroundColor Cyan
  Start-Process $url
}
