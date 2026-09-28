-- NABS Race Control PiP  v0.5
-- Erkennt stehende Autos und Dreher und blendet sie automatisch als Bild-im-Bild ein.
-- Funktioniert offline (Singleplayer mit KI) und online. Nur bei Race Control installieren.

---------------------------------------------------------------------------------------------------
-- Einstellungen (werden automatisch gespeichert)
---------------------------------------------------------------------------------------------------

local S = ac.storage({
  enabled = true,       -- PiP automatisch einblenden
  maxPip = 2,           -- maximal gleichzeitige Vorfaelle (Zeilen)
  width = 360,          -- Breite eines PiP-Fensters in Pixeln
  viewTop = true,       -- Ansichten pro Vorfall (Spalten nebeneinander)
  viewChase = false,
  viewSide = false,
  viewTrack = true,
  stopKmh = 8,          -- unter dieser Geschwindigkeit gilt ein Auto als stehend
  holdSec = 3,          -- so lange muss es stehen, bevor es gemeldet wird
  detectSpins = true,   -- Dreher erkennen
  ignoreOwn = false,    -- eigenes Auto ignorieren (zum Testen aus lassen)
  posX = 30,            -- Position der PiP-Fenster auf dem Bildschirm
  posY = 120,
  fps = 30,             -- Bildrate der PiP-Fenster (weniger = mehr FPS im Spiel)
  quality = 1,          -- 1 = hohe Qualitaet, 2 = schnell
  autoExposure = true,  -- automatische Belichtung (wie eine Kamera)
  exposure = 1,         -- Belichtungskorrektur (Faktor)
  gamma = true,
  shadowLift = 0.35,    -- dunkle Bereiche (z.B. Reifen im Schatten) aufhellen, 0 = aus
  ownShadows = false,   -- eigene Schattenberechnung je Fenster (genauer, kostet Leistung)         -- Gamma-Korrektur (bei Pure/linearer Beleuchtung an lassen)
}, 'nabsPip3_')

-- Verfuegbare Ansichten: key = Einstellung, name = Anzeige
local VIEWS = {
  { key = 'viewTop', name = 'Von oben' },
  { key = 'viewChase', name = 'Verfolger' },
  { key = 'viewSide', name = 'Seitlich' },
  { key = 'viewTrack', name = 'Streckenkamera' },
}
local APP_VERSION = '0.5'
local QUALITY_NAMES = { 'Hohe Qualitaet', 'Schnell' }
local KIND_LABEL = { stopped = 'STEHT', spin = 'DREHER', test = 'TEST' }
local KIND_COLOR = {
  stopped = rgbm(0.95, 0.2, 0.2, 1),
  spin = rgbm(1, 0.6, 0.1, 1),
  test = rgbm(0.3, 0.6, 1, 1),
}

---------------------------------------------------------------------------------------------------
-- Hilfsfunktionen
---------------------------------------------------------------------------------------------------

-- Liest ein Feld sicher aus (falls ein Feld in einer CSP-Version fehlt, gibt es den Standardwert)
local function get(obj, key, default)
  local ok, v = pcall(function() return obj[key] end)
  if ok and v ~= nil then return v end
  return default
end

local function driverName(i)
  local ok, n = pcall(ac.getDriverName, i)
  if ok and n and n ~= '' then return n end
  return 'Auto ' .. (i + 1)
end

local function timeStamp()
  local ok, t = pcall(os.date, '%H:%M:%S')
  return ok and t or ''
end

-- Horizontale Blickrichtung eines Autos (normalisiert)
local function heading(car)
  local f = car.look
  local l = math.sqrt(f.x * f.x + f.z * f.z)
  if l < 0.01 then return 0, 1 end
  return f.x / l, f.z / l
end

---------------------------------------------------------------------------------------------------
-- Erkennung
---------------------------------------------------------------------------------------------------

local clock = 0
local carState = {}   -- Zustand je Auto (0-basierter Index)
local incidents = {}  -- aktive Vorfaelle je Auto
local log = {}        -- letzte Meldungen fuer das Fenster
local testCursor = 0

local function addLog(text)
  table.insert(log, 1, timeStamp() .. '  ' .. text)
  if #log > 12 then table.remove(log) end
end

local function clearIncident(i)
  incidents[i] = nil
end

local function raise(i, kind, car)
  local inc = incidents[i]
  if inc and inc.resolved and kind ~= 'test' then
    -- Auto war schon wieder unterwegs und hat einen neuen Vorfall: Eintrag neu starten
    incidents[i] = nil
    inc = nil
  end
  if inc then
    inc.lastSeen = clock
    -- ein Dreher, der mit einem stehenden Auto endet, wird zu "steht"
    if kind == 'stopped' and inc.kind == 'spin' then
      inc.kind = 'stopped'
      addLog(driverName(i) .. ' steht nach Dreher')
    end
    return
  end
  local hx, hz = heading(car)
  incidents[i] = { car = i, kind = kind, since = clock, lastSeen = clock, hx = hx, hz = hz }
  addLog(driverName(i) .. (kind == 'stopped' and ' steht auf der Strecke' or kind == 'spin' and ' dreht sich' or ' (Test)'))
end

local function trackCar(i, car, dt)
  local st = carState[i]
  if not st then
    st = { moved = false, stopT = 0, spinT = 0, lastPos = nil }
    carState[i] = st
  end

  local pos = car.position
  local speed = get(car, 'speedKmh', 0)
  local connected = get(car, 'isConnected', true)
  local inPit = get(car, 'isInPitlane', false) or get(car, 'isInPit', false)

  -- Teleport (z.B. zurueck in die Box gesetzt): Erkennung zuruecksetzen (Fenster bleibt offen)
  if st.lastPos then
    local dx, dy, dz = pos.x - st.lastPos.x, pos.y - st.lastPos.y, pos.z - st.lastPos.z
    if dx * dx + dy * dy + dz * dz > 3600 then
      st.moved, st.stopT, st.spinT = false, 0, 0
    end
  end
  st.lastPos = vec3(pos.x, pos.y, pos.z)

  -- Boxengasse, nicht verbunden oder eigenes Auto (falls ignoriert): nichts Neues melden
  if not connected or inPit or (S.ignoreOwn and i == 0) then
    st.moved, st.stopT, st.spinT = false, 0, 0
    return
  end

  -- Erst melden, wenn das Auto seit dem Start schon einmal richtig gefahren ist
  -- (verhindert Meldungen in der Startaufstellung)
  if speed > 40 then st.moved = true end

  -- Stehendes Auto
  if st.moved and speed < S.stopKmh then
    st.stopT = st.stopT + dt
    if st.stopT >= S.holdSec then raise(i, 'stopped', car) end
  else
    st.stopT = 0
  end

  -- Dreher: Auto zeigt deutlich in eine andere Richtung, als es faehrt
  if S.detectSpins and speed > 20 then
    local v = car.velocity
    local vl = math.sqrt(v.x * v.x + v.z * v.z)
    local hx, hz = heading(car)
    if vl > 0.1 then
      local cosAngle = (v.x * hx + v.z * hz) / vl
      if cosAngle < 0.34 then st.spinT = st.spinT + dt else st.spinT = 0 end  -- mehr als ca. 70 Grad
      if st.spinT > 0.25 then raise(i, 'spin', car) end
    end
  else
    st.spinT = 0
  end

  -- Faehrt ein stehendes Auto wieder, nur markieren (Fenster bleibt offen, bis es geschlossen wird)
  local inc = incidents[i]
  if inc and inc.kind == 'stopped' and not inc.resolved then
    if speed > S.stopKmh + 10 then
      inc.clearT = (inc.clearT or 0) + dt
      if inc.clearT > 3 then
        inc.resolved = true
        addLog(driverName(i) .. ' faehrt weiter')
      end
    else
      inc.clearT = 0
    end
  end
end

function script.update(dt)
  clock = clock + dt
  local sim = ac.getSim()
  if get(sim, 'isPaused', false) or get(sim, 'isReplayActive', false) then return end

  local count = get(sim, 'carsCount', 1)
  for i = 0, count - 1 do
    local car = ac.getCar(i)
    if car then trackCar(i, car, dt) end
  end
end

---------------------------------------------------------------------------------------------------
-- Bild-im-Bild
---------------------------------------------------------------------------------------------------

local slots = {}          -- slots[k] = Autoindex, der in Zeile k gezeigt wird
local shots = {}          -- shots[k][v] = GeometryShot fuer Zeile k, Ansicht v
local shotConfig = ''     -- wenn sich Groesse oder Qualitaet aendert, werden die Shots neu erstellt
local lastShotUpdate = {} -- lastShotUpdate[k] = Zeitpunkt der letzten Aktualisierung der Zeile k

local function pipSize()
  local w = math.floor(S.width)
  return w, math.floor(w * 9 / 16)
end

-- Liste der eingeschalteten Ansichten (mindestens eine)
local function activeViews()
  local list = {}
  for v, view in ipairs(VIEWS) do
    if S[view.key] then table.insert(list, v) end
  end
  if #list == 0 then list[1] = 1 end
  return list
end

local function mipCount(w, h)
  return math.floor(math.log(math.max(w, h)) / math.log(2)) + 1
end

local function makeShot(w, h)
  -- Bild in voller Helligkeitsaufloesung (Float) mit MIPs berechnen: so wird Weiss nicht abgeschnitten,
  -- und die kleinste MIP-Stufe liefert die Durchschnittshelligkeit fuer die automatische Belichtung.
  local shaders = math.floor(S.quality) == 2 and render.ShadersType.SimplifiedWithLights or render.ShadersType.Main
  local shot = ac.GeometryShot(ac.findNodes('sceneRoot:yes'), vec2(w, h), mipCount(w, h), false,
    render.AntialiasingMode.None, render.TextureFormat.R16G16B16A16.Float)
  pcall(function() shot:setSky(true) end)
  pcall(function() shot:setOriginalLighting(true) end)
  pcall(function() shot:setShadersType(shaders) end)
  pcall(function() shot:setParticles(true) end)
  pcall(function() shot:setFakeCarShadows(true) end)
  pcall(function() shot:setClippingPlanes(0.3, 3000) end)
  pcall(function() shot:setClearColor(rgbm(0.1, 0.1, 0.1, 1)) end)
  pcall(function() shot:setOpaqueAlphaFix(true) end)
  if S.ownShadows then pcall(function() shot:setAlternativeShadowsSet('dedicated') end) end
  return shot
end

-- Belichtung + Tonemapping (ACES) + Gamma, damit das Bild aussieht wie mit einer echten Kamera
local TONEMAP_SHADER = [[
float3 acesFilm(float3 x) {
  return saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}
float4 main(PS_IN pin) {
  float3 avg = txIn.SampleLevel(samLinearClamp, float2(0.5, 0.5), gAvgMip).rgb;
  float lum = max(dot(avg, float3(0.2126, 0.7152, 0.0722)), 0.0001);
  float exposure = gAuto > 0.5 ? clamp(0.18 / lum, 0.0005, 2000.0) : 1.0;
  float3 c = txIn.SampleLevel(samLinearClamp, pin.Tex, 0).rgb * exposure * gExposure;
  c = acesFilm(max(c, (float3)0));
  c = lerp(c, sqrt(c), gLift);
  if (gGamma > 0.5) c = pow(c, (float3)(1.0 / 2.2));
  return float4(c, 1);
}
]]

local shaderParams = {} -- je Fenster eine wiederverwendete Parameter-Tabelle

local function drawShot(key, shot, p1, p2)
  local w, h = pipSize()
  local params = shaderParams[key]
  if not params then
    params = {
      async = true,
      cacheKey = 7302,
      p1 = p1, p2 = p2,
      textures = { txIn = shot },
      values = { gAvgMip = 0, gAuto = 1, gExposure = 1, gGamma = 1, gLift = 0 },
      shader = TONEMAP_SHADER,
    }
    shaderParams[key] = params
  end
  params.p1, params.p2 = p1, p2
  params.textures.txIn = shot
  params.values.gAvgMip = mipCount(w, h) - 1
  params.values.gAuto = S.autoExposure and 1 or 0
  params.values.gExposure = S.exposure
  params.values.gGamma = S.gamma and 1 or 0
  params.values.gLift = math.max(0, math.min(1, S.shadowLift))
  if ui.renderShader then
    ui.renderShader(params)
  else
    ui.drawImage(shot, p1, p2)
  end
end

local function getShot(k, v)
  local w, h = pipSize()
  local cfg = w .. 'x' .. h .. 'q' .. math.floor(S.quality) .. (S.ownShadows and 's' or '')
  if cfg ~= shotConfig then
    for _, row in pairs(shots) do
      for _, shot in pairs(row) do pcall(function() shot:dispose() end) end
    end
    shots, lastShotUpdate, shotConfig = {}, {}, cfg
  end
  shots[k] = shots[k] or {}
  if not shots[k][v] then shots[k][v] = makeShot(w, h) end
  return shots[k][v]
end

-- Zeilen stabil belegen: Autos bleiben in ihrer Zeile, neue Vorfaelle fuellen freie Zeilen
local function updateSlots()
  local maxPip = math.floor(S.maxPip)
  for k = 1, 3 do
    if k > maxPip or (slots[k] ~= nil and not incidents[slots[k]]) then slots[k] = nil end
  end
  local shown = {}
  for k = 1, maxPip do if slots[k] ~= nil then shown[slots[k]] = true end end

  local waiting = {}
  for i, inc in pairs(incidents) do
    if not shown[i] then table.insert(waiting, inc) end
  end
  table.sort(waiting, function(a, b) return a.since > b.since end)

  for k = 1, maxPip do
    if slots[k] == nil and #waiting > 0 then
      slots[k] = table.remove(waiting, 1).car
    end
  end
end

local function aimShot(shot, inc, view)
  local car = ac.getCar(inc.car)
  if not car then return end
  local p = car.position

  -- Bei Test-Vorfaellen der aktuellen Fahrtrichtung folgen, sonst die Richtung beim Vorfall festhalten
  local hx, hz = inc.hx, inc.hz
  if inc.kind == 'test' then hx, hz = heading(car) end

  if view == 4 then
    local ok = pcall(function() shot:updateWithTrackCamera(inc.car) end)
    if ok then return end
    view = 2 -- falls die CSP-Version das nicht kann: Verfolger
  end

  local cx, cy, cz, tx, ty, tz, fov
  if view == 1 then
    -- schraeg von oben, wie eine Drohne ueber dem Auto
    cx, cy, cz = p.x - hx * 10, p.y + 24, p.z - hz * 10
    tx, ty, tz = p.x, p.y, p.z
    fov = 45
  elseif view == 3 then
    -- seitlich, auf Hoehe des Autos (rechts neben dem Auto)
    local sx, sz = hz, -hx
    cx, cy, cz = p.x + sx * 9, p.y + 1.6, p.z + sz * 9
    tx, ty, tz = p.x, p.y + 0.6, p.z
    fov = 55
  else
    -- hinter dem Auto
    cx, cy, cz = p.x - hx * 8, p.y + 3.2, p.z - hz * 8
    tx, ty, tz = p.x, p.y + 0.8, p.z
    fov = 55
  end

  local dx, dy, dz = tx - cx, ty - cy, tz - cz
  local l = math.sqrt(dx * dx + dy * dy + dz * dz)
  shot:update(vec3(cx, cy, cz), vec3(dx / l, dy / l, dz / l), vec3(0, 1, 0), fov)
end

local function drawFrame(x, y, w, h, col)
  ui.drawRectFilled(vec2(x, y), vec2(x + w, y + 3), col)
  ui.drawRectFilled(vec2(x, y + h - 3), vec2(x + w, y + h), col)
  ui.drawRectFilled(vec2(x, y), vec2(x + 3, y + h), col)
  ui.drawRectFilled(vec2(x + w - 3, y), vec2(x + w, y + h), col)
end

function script.drawOverlay()
  if not S.enabled then return end
  updateSlots()

  local rows = {}
  for k = 1, math.floor(S.maxPip) do
    if slots[k] ~= nil and incidents[slots[k]] then table.insert(rows, k) end
  end
  if #rows == 0 then return end

  local views = activeViews()
  local w, h = pipSize()
  local gap = 6
  local totalW = #views * w + (#views - 1) * gap
  local totalH = #rows * (h + gap)

  ui.transparentWindow('nabsPipOverlay', vec2(S.posX, S.posY), vec2(totalW, totalH), true, false, function()
    for n, k in ipairs(rows) do
      local inc = incidents[slots[k]]
      local y = (n - 1) * (h + gap)
      local col = KIND_COLOR[inc.kind] or rgbm(1, 1, 1, 1)

      -- Bilder nur mit der eingestellten Bildrate neu berechnen
      local refresh = clock - (lastShotUpdate[k] or -1) >= 1 / math.max(S.fps, 1)
      if refresh then lastShotUpdate[k] = clock end

      for c, v in ipairs(views) do
        local x = (c - 1) * (w + gap)
        local shot = getShot(k, v)
        if refresh then
          aimShot(shot, inc, v)
          pcall(function() shot:mipsUpdate() end)
        end
        ui.drawRectFilled(vec2(x, y), vec2(x + w, y + h), rgbm(0, 0, 0, 1)) -- deckender Hintergrund
        drawShot(k .. '_' .. v, shot, vec2(x, y), vec2(x + w, y + h))
        drawFrame(x, y, w, h, col)

        -- Name der Ansicht unten links
        ui.drawRectFilled(vec2(x + 3, y + h - 22), vec2(x + 120, y + h - 3), rgbm(0, 0, 0, 0.55))
        ui.setCursor(vec2(x + 8, y + h - 20))
        ui.textColored(VIEWS[v].name, rgbm(1, 1, 1, 0.85))
      end

      -- Beschriftung ueber die ganze Zeile
      ui.drawRectFilled(vec2(3, y + 3), vec2(totalW - 3, y + 26), rgbm(0, 0, 0, 0.65))
      ui.setCursor(vec2(10, y + 6))
      ui.textColored(KIND_LABEL[inc.kind] or '', col)
      ui.sameLine()
      ui.textColored(driverName(inc.car) .. '   ' .. math.floor(clock - inc.since) .. ' s'
        .. (inc.resolved and '   (faehrt wieder)' or ''), rgbm(1, 1, 1, 1))
    end
  end)
end

---------------------------------------------------------------------------------------------------
-- Fenster mit Einstellungen und Test-Knoepfen
---------------------------------------------------------------------------------------------------

local function checkbox(label, key)
  if ui.checkbox(label, S[key]) then S[key] = not S[key] end
end

local function slider(label, key, min, max, format, integer)
  local v = ui.slider(label, S[key], min, max, format, integer or nil)
  if v ~= S[key] then S[key] = v end
end

function script.windowMain(dt)
  ui.textColored('Version ' .. APP_VERSION .. '  (Fenster bleiben offen, bis sie geschlossen werden)', rgbm(0.6, 0.8, 1, 1))
  ui.separator()
  -- Offene Vorfaelle mit Schliessen-Knopf (Fenster gehen nicht mehr von selbst zu)
  local list = {}
  for _, inc in pairs(incidents) do table.insert(list, inc) end
  table.sort(list, function(a, b) return a.since > b.since end)

  ui.text('Offene Vorfaelle: ' .. #list)
  for _, inc in ipairs(list) do
    if ui.button('Schliessen##close' .. inc.car) then clearIncident(inc.car) end
    ui.sameLine()
    ui.textColored((KIND_LABEL[inc.kind] or '') .. '  ' .. driverName(inc.car)
      .. (inc.resolved and '  (faehrt wieder)' or ''), KIND_COLOR[inc.kind] or rgbm(1, 1, 1, 1))
  end
  if #list > 1 and ui.button('Alle schliessen') then
    for i in pairs(incidents) do clearIncident(i) end
  end
  if #list > math.floor(S.maxPip) then
    ui.text((#list - math.floor(S.maxPip)) .. ' weitere warten, bis ein Fenster geschlossen wird.')
  end
  ui.separator()

  checkbox('Bild-im-Bild automatisch einblenden', 'enabled')

  ui.text('Ansichten pro Vorfall (nebeneinander):')
  for _, view in ipairs(VIEWS) do checkbox(view.name, view.key) end

  ui.separator()
  ui.text('Test (Singleplayer):')
  if ui.button('Naechstes Auto zeigen') then
    local count = get(ac.getSim(), 'carsCount', 1)
    testCursor = (testCursor + 1) % math.max(count, 1)
    local car = ac.getCar(testCursor)
    if car then
      clearIncident(testCursor)
      raise(testCursor, 'test', car)
    end
  end
  ui.sameLine()
  if ui.button('Tests beenden') then
    for i, inc in pairs(incidents) do
      if inc.kind == 'test' then clearIncident(i) end
    end
  end
  ui.text('Tipp: Auf der Strecke anhalten, nach 3 s geht')
  ui.text('das Fenster automatisch auf.')

  ui.separator()
  ui.text('Bild:')
  for q = 1, #QUALITY_NAMES do
    if q > 1 then ui.sameLine() end
    local label = (math.floor(S.quality) == q and '> ' or '') .. QUALITY_NAMES[q]
    if ui.button(label) then S.quality = q end
  end
  checkbox('Automatische Belichtung', 'autoExposure')
  slider('##exposure', 'exposure', 0.2, 4, 'Belichtung: %.2fx', 2)
  checkbox('Gamma-Korrektur (bei zu dunkel/kontrastreich umschalten)', 'gamma')
  slider('##shadowLift', 'shadowLift', 0, 1, 'Schatten aufhellen: %.2f')
  checkbox('Eigene Schatten je Fenster (genauer, kostet FPS)', 'ownShadows')
  slider('##width', 'width', 200, 800, 'Breite je Fenster: %.0f px', true)
  slider('##fps', 'fps', 5, 60, 'Bildrate: %.0f fps', true)
  slider('##posX', 'posX', 0, 3000, 'Position X: %.0f', true)
  slider('##posY', 'posY', 0, 2000, 'Position Y: %.0f', true)

  ui.separator()
  ui.text('Erkennung:')
  slider('##maxPip', 'maxPip', 1, 3, 'Max. Vorfaelle gleichzeitig: %.0f', true)
  slider('##stopKmh', 'stopKmh', 2, 30, 'Steht unter: %.0f km/h', true)
  slider('##holdSec', 'holdSec', 1, 10, 'Melden nach: %.0f s', true)
  checkbox('Dreher erkennen', 'detectSpins')
  checkbox('Eigenes Auto ignorieren', 'ignoreOwn')

  ui.separator()
  ui.text('Letzte Meldungen:')
  if #log == 0 then ui.text('  (noch keine)') end
  for _, line in ipairs(log) do ui.text(line) end
end
