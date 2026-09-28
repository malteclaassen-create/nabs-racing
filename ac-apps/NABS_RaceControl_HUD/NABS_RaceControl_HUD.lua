-- NABS Race Control HUD  v1.2
-- Broadcast-style version of the race control picture-in-picture.
-- Same detection as the full app (stopped cars, spins), with a small control window.
-- Install for race control only. Don't run it together with NABS_RaceControl_PiP (you'd get the HUD twice).
--
-- v1.2: contacts from the website. The race server reports every collision
-- (car or wall) to nabsracing.com, and with your pairing code (Admin > Race
-- control) the app picks them up about half a second after they happen and
-- opens the camera tiles for that car. The game can't see other cars' contacts
-- itself, only the server can. Format: RACE-CONTROL.md.

---------------------------------------------------------------------------------------------------
-- Settings (saved automatically)
---------------------------------------------------------------------------------------------------

local S = ac.storage({
  enabled = true,
  maxPip = 2,           -- incidents on screen at once
  width = 400,          -- width of one camera tile in pixels
  viewTop = true,       -- camera tiles per incident, side by side
  viewChase = false,
  viewSide = false,
  viewTrack = true,
  stopKmh = 8,          -- below this a car counts as stopped
  holdSec = 3,          -- how long it has to stand before it's reported
  detectSpins = true,
  ignoreOwn = false,
  posX = 40,            -- HUD position on screen
  posY = 140,
  fps = 30,             -- tile refresh rate (lower = more fps in game)
  quality = 1,          -- 1 = high quality, 2 = fast
  autoExposure = true,
  exposure = 1,
  gamma = true,
  shadowLift = 0.35,    -- dunkle Bereiche (z.B. Reifen im Schatten) aufhellen, 0 = aus
  ownShadows = false,   -- eigene Schattenberechnung je Fenster (genauer, kostet Leistung)
  rcOn = true,          -- contacts from the website
  rcCode = '',          -- pairing code from Admin > Race control
  rcUrl = 'https://nabsracing.com',
}, 'nabsHud1_')

local VIEWS = {
  { key = 'viewTop', name = 'Von oben', short = 'TOP' },
  { key = 'viewChase', name = 'Verfolger', short = 'CHASE' },
  { key = 'viewSide', name = 'Seitlich', short = 'SIDE' },
  { key = 'viewTrack', name = 'Streckenkamera', short = 'TV CAM' },
}
local APP_VERSION = '1.2'
local KIND_LABEL = { stopped = 'CAR STOPPED', spin = 'SPIN', test = 'TEST', contact = 'CONTACT', wall = 'WALL' }
local KIND_COLOR = {
  stopped = rgbm(0.9, 0.28, 0.3, 1),
  spin = rgbm(0.96, 0.65, 0.14, 1),
  test = rgbm(0.24, 0.61, 1, 1),
  contact = rgbm(0.94, 0.27, 0.27, 1),
  wall = rgbm(1, 0.52, 0.12, 1),
}
local RESOLVED_COLOR = rgbm(0.3, 0.78, 0.5, 1)
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

local function raise(i, kind, car, detail)
  local inc = incidents[i]
  -- A contact is news even when the car already has a card: it replaces it.
  if inc and (kind == 'contact' or kind == 'wall') then
    incidents[i] = nil
    inc = nil
  end
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
  incidents[i] = { car = i, kind = kind, since = clock, lastSeen = clock, hx = hx, hz = hz, detail = detail }
  local what = kind == 'stopped' and ' steht auf der Strecke' or kind == 'spin' and ' dreht sich'
    or kind == 'contact' and ' Kontakt' or kind == 'wall' and ' Mauer' or ' (Test)'
  addLog(driverName(i) .. what .. (detail and ('  ' .. detail) or ''))
end

---------------------------------------------------------------------------------------------------
-- Contacts from the website (long polling: the site answers as soon as there is one)
---------------------------------------------------------------------------------------------------

local net = { busy = false, cursor = nil, retryAt = 0, status = 'off', lastAt = nil, fails = 0 }

local function sameName(a, b)
  return a ~= nil and b ~= nil and string.lower(a) == string.lower(b)
end

-- The server numbers cars by their slot (CarID); CSP calls that sessionID.
-- The driver name has to match too, so a contact from the league's other
-- server never lands on whoever sits in the same slot here.
local function localCarFor(carId, name)
  if carId ~= nil and ac.getCar.serverSlot then
    local ok, car = pcall(ac.getCar.serverSlot, carId)
    local idx = ok and car and get(car, 'index', nil) or nil
    if idx ~= nil and (name == nil or sameName(driverName(idx), name)) then return idx, car end
  end
  local count = get(ac.getSim(), 'carsCount', 1)
  local byName = nil
  for i = 0, count - 1 do
    local car = ac.getCar(i)
    if car then
      local sid = get(car, 'sessionID', -1)
      local nm = driverName(i)
      if carId ~= nil and sid == carId and (name == nil or sameName(nm, name)) then return i, car end
      if byName == nil and sameName(nm, name) then byName = i end
    end
  end
  if byName ~= nil then return byName, ac.getCar(byName) end
  return nil
end

local function onContact(ev)
  if get(ac.getSim(), 'isReplayActive', false) then return end
  local i, car = localCarFor(ev.carId, ev.driver)
  if i == nil or not car then return end
  if S.ignoreOwn and i == 0 then return end
  local kmh = ev.kmh and string.format('%d km/h', math.floor(ev.kmh + 0.5)) or nil
  local detail = kmh
  if ev.kind == 'car' and ev.other then detail = (kmh and (kmh .. ', ') or '') .. 'with ' .. ev.other end
  raise(i, ev.kind == 'car' and 'contact' or 'wall', car, detail)
end

local function pollWebsite()
  if net.busy or not S.rcOn or S.rcCode == '' or clock < net.retryAt then return end
  if not web or not web.get then
    net.status = 'no web in this CSP'
    return
  end
  local url = S.rcUrl .. '/api/race-control/app/next?code=' .. S.rcCode
  if net.cursor ~= nil then url = url .. '&after=' .. net.cursor .. '&wait=20' end
  net.busy = true
  local ok = pcall(web.get, url, function(err, response)
    net.busy = false
    local status = response and response.status or 0
    if err or status == 0 then
      net.fails = net.fails + 1
      net.status = 'no connection'
      net.retryAt = clock + math.min(30, 2 * net.fails)
      return
    end
    if status == 401 then
      net.status = 'code not accepted'
      net.retryAt = clock + 30
      return
    end
    if status ~= 200 then
      net.fails = net.fails + 1
      net.status = 'site answered ' .. status
      net.retryAt = clock + math.min(30, 2 * net.fails)
      return
    end
    local okJson, data = pcall(JSON.parse, response.body)
    if not okJson or type(data) ~= 'table' then
      net.status = 'unreadable answer'
      net.retryAt = clock + 5
      return
    end
    net.fails = 0
    net.status = 'connected'
    net.cursor = data.cursor or net.cursor
    for _, ev in ipairs(data.collisions or {}) do
      pcall(onContact, ev)
      net.lastAt = timeStamp()
    end
    net.retryAt = clock -- straight back to listening
  end)
  if not ok then
    net.busy = false
    net.status = 'request failed'
    net.retryAt = clock + 10
  end
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
  pollWebsite() -- keeps listening in a pause or a replay too
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


---------------------------------------------------------------------------------------------------
-- Broadcast HUD
---------------------------------------------------------------------------------------------------

local PANEL = rgbm(0.055, 0.06, 0.075, 0.94)
local PANEL_EDGE = rgbm(1, 1, 1, 0.07)
local TEXT_DIM = rgbm(0.62, 0.65, 0.7, 1)
local HEADER_H = 34
local ACCENT_W = 4
local TILE_GAP = 2
local CARD_GAP = 10
local TITLE_H = 22

local function mmss(sec)
  sec = math.max(0, math.floor(sec))
  return string.format('%02d:%02d', math.floor(sec / 60), sec % 60)
end

local function textWidth(text, fallbackCharW)
  local ok, size = pcall(ui.measureText, text)
  if ok and size and size.x then return size.x end
  return #text * (fallbackCharW or 7)
end

local function outlinedText(text, color)
  local ok = pcall(ui.beginOutline)
  ui.textColored(text, color)
  if ok then pcall(ui.endOutline, rgbm(0, 0, 0, 0.9), 1) end
end

local function drawTitleStrip(width)
  ui.drawRectFilled(vec2(0, 0), vec2(width, TITLE_H), rgbm(0.03, 0.035, 0.045, 0.9))
  -- pulsing live dot
  local pulse = 0.55 + 0.45 * math.sin(clock * 4)
  ui.drawCircleFilled(vec2(12, TITLE_H / 2), 4, rgbm(0.9, 0.2, 0.22, pulse), 16)
  ui.pushFont(ui.Font.Small)
  ui.setCursor(vec2(24, 4))
  ui.textColored('NABS', rgbm(1, 1, 1, 1))
  ui.sameLine(0, 6)
  ui.textColored('RACE CONTROL', TEXT_DIM)
  ui.popFont()
end

local function drawCard(y, inc, k, views, w, h, cardW)
  local resolved = inc.resolved
  local col = resolved and RESOLVED_COLOR or (KIND_COLOR[inc.kind] or rgbm(1, 1, 1, 1))
  local cardH = HEADER_H + h

  -- panel + accent stripe (flashes for the first moments of a new incident)
  ui.drawRectFilled(vec2(0, y), vec2(cardW, y + cardH), PANEL)
  local age = clock - inc.since
  local flash = age < 1.5 and (0.5 + 0.5 * math.sin(age * 18)) or 0
  local accent = rgbm(col.r + (1 - col.r) * flash, col.g + (1 - col.g) * flash, col.b + (1 - col.b) * flash, 1)
  ui.drawRectFilled(vec2(0, y), vec2(ACCENT_W, y + cardH), accent)

  -- tag pill
  local tag = resolved and 'MOVING AGAIN' or (KIND_LABEL[inc.kind] or '')
  ui.pushFont(ui.Font.Small)
  local tagW = textWidth(tag, 7) + 14
  ui.drawRectFilled(vec2(ACCENT_W + 10, y + 8), vec2(ACCENT_W + 10 + tagW, y + HEADER_H - 8), col, 3)
  ui.setCursor(vec2(ACCENT_W + 17, y + 10))
  ui.textColored(tag, rgbm(0.04, 0.04, 0.05, 1))
  ui.popFont()

  -- driver name
  ui.pushFont(ui.Font.Title)
  ui.setCursor(vec2(ACCENT_W + 20 + tagW, y + 5))
  ui.textColored(driverName(inc.car), rgbm(1, 1, 1, 1))
  ui.popFont()
  if inc.detail then
    ui.pushFont(ui.Font.Small)
    ui.sameLine(0, 10)
    ui.setCursorY(y + 11)
    ui.textColored(inc.detail, TEXT_DIM)
    ui.popFont()
  end

  -- timer, right aligned
  local t = mmss(age)
  ui.pushFont(ui.Font.Monospace)
  ui.setCursor(vec2(cardW - textWidth(t, 8) - 12, y + 9))
  ui.textColored(t, TEXT_DIM)
  ui.popFont()

  -- camera tiles
  local refresh = clock - (lastShotUpdate[k] or -1) >= 1 / math.max(S.fps, 1)
  if refresh then lastShotUpdate[k] = clock end

  local ty = y + HEADER_H
  for c, v in ipairs(views) do
    local x = ACCENT_W + (c - 1) * (w + TILE_GAP)
    local shot = getShot(k, v)
    if refresh then
      aimShot(shot, inc, v)
      pcall(function() shot:mipsUpdate() end)
    end
    ui.drawRectFilled(vec2(x, ty), vec2(x + w, ty + h), rgbm(0, 0, 0, 1))
    drawShot(k .. '_' .. v, shot, vec2(x, ty), vec2(x + w, ty + h))

    -- thin inner edge + camera label
    ui.drawRectFilled(vec2(x, ty), vec2(x + w, ty + 1), PANEL_EDGE)
    ui.pushFont(ui.Font.Tiny)
    ui.setCursor(vec2(x + 8, ty + h - 18))
    outlinedText(VIEWS[v].short, rgbm(1, 1, 1, 0.9))
    ui.popFont()
  end

  return cardH
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
  local cardW = ACCENT_W + #views * w + (#views - 1) * TILE_GAP
  local totalH = TITLE_H + 4 + #rows * (HEADER_H + h + CARD_GAP)

  ui.transparentWindow('nabsHudOverlay', vec2(S.posX, S.posY), vec2(cardW, totalH), true, false, function()
    drawTitleStrip(cardW)
    local y = TITLE_H + 4
    for _, k in ipairs(rows) do
      y = y + drawCard(y, incidents[slots[k]], k, views, w, h, cardW) + CARD_GAP
    end
  end)
end

---------------------------------------------------------------------------------------------------
-- Small control window
---------------------------------------------------------------------------------------------------

local function slider(label, key, min, max, format, power)
  local v = ui.slider(label, S[key], min, max, format, power)
  if v ~= S[key] then S[key] = v end
end

function script.windowMain(dt)
  ui.pushFont(ui.Font.Small)
  ui.textColored('NABS Race Control HUD  v' .. APP_VERSION, TEXT_DIM)
  ui.popFont()

  -- open incidents
  local list = {}
  for _, inc in pairs(incidents) do table.insert(list, inc) end
  table.sort(list, function(a, b) return a.since > b.since end)

  if #list == 0 then
    ui.textColored('No open incidents', TEXT_DIM)
  end
  for _, inc in ipairs(list) do
    if ui.button('x##close' .. inc.car, vec2(22, 0)) then clearIncident(inc.car) end
    ui.sameLine()
    local col = inc.resolved and RESOLVED_COLOR or (KIND_COLOR[inc.kind] or rgbm(1, 1, 1, 1))
    ui.textColored(inc.resolved and 'MOVING' or (KIND_LABEL[inc.kind] or ''), col)
    ui.sameLine()
    ui.text(driverName(inc.car))
  end
  if #list > 1 and ui.button('Clear all') then
    for i in pairs(incidents) do clearIncident(i) end
  end
  if #list > math.floor(S.maxPip) then
    ui.textColored('+' .. (#list - math.floor(S.maxPip)) .. ' waiting', TEXT_DIM)
  end

  ui.separator()

  -- camera tiles as toggle buttons
  for i, view in ipairs(VIEWS) do
    if i > 1 then ui.sameLine(0, 4) end
    local label = (S[view.key] and '* ' or '') .. view.short
    if ui.button(label .. '##view' .. i) then S[view.key] = not S[view.key] end
  end

  if ui.button('Test: next car') then
    local count = get(ac.getSim(), 'carsCount', 1)
    testCursor = (testCursor + 1) % math.max(count, 1)
    local car = ac.getCar(testCursor)
    if car then
      clearIncident(testCursor)
      raise(testCursor, 'test', car)
    end
  end
  ui.sameLine()
  if ui.checkbox('Ignore own car', S.ignoreOwn) then S.ignoreOwn = not S.ignoreOwn end

  slider('##exposure', 'exposure', 0.2, 4, 'Exposure %.2fx', 2)
  slider('##shadowLift', 'shadowLift', 0, 1, 'Shadow lift %.2f')
  if ui.checkbox('Own shadows per tile (costs fps)', S.ownShadows) then S.ownShadows = not S.ownShadows end
  slider('##posX', 'posX', 0, 3000, 'HUD X %.0f', true)
  slider('##posY', 'posY', 0, 2000, 'HUD Y %.0f', true)

  ui.separator()
  if ui.checkbox('Contacts from nabsracing.com', S.rcOn) then S.rcOn = not S.rcOn end
  local okInput, value = pcall(ui.inputText, 'Pairing code', S.rcCode)
  if okInput and type(value) == 'string' then
    local clean = string.upper(value):gsub('[^A-Z0-9]', '')
    if clean ~= S.rcCode then
      S.rcCode = clean
      net.cursor, net.retryAt, net.fails = nil, 0, 0
      net.status = clean == '' and 'off' or 'connecting'
    end
  end
  local statusText
  if not S.rcOn then
    statusText = 'Off'
  elseif S.rcCode == '' then
    statusText = 'Enter the code from Admin > Race control'
  else
    statusText = net.status .. (net.lastAt and ('  (last contact ' .. net.lastAt .. ')') or '')
  end
  ui.textColored(statusText, net.status == 'connected' and RESOLVED_COLOR or TEXT_DIM)
end
