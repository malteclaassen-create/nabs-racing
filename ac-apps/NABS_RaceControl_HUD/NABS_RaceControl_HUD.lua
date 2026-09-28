-- NABS Race Control  v1.6
-- Broadcast-style version of the race control picture-in-picture.
-- Same detection as the full app (stopped cars, spins), with a small control window.
-- Install for race control only. Don't run it together with NABS_RaceControl_PiP (you'd get the HUD twice).
--
-- v1.2: contacts from the website. The race server reports every collision
-- (car or wall) to nabsracing.com, and with your pairing code (Admin > Race
-- control) the app picks them up about half a second after they happen and
-- opens the camera tiles for that car. The game can't see other cars' contacts
-- itself, only the server can. Format: RACE-CONTROL.md.
--
-- v1.3: a sound on contacts (on/off), filters for what pops up, a crash with
-- several cars in one place becomes one PILE-UP card, and the window is split
-- into tabs with a short explanation on each.
--
-- v1.4: cards close by themselves (how long is set per kind, 0 = until you
-- close it), what pops up by itself is set per kind (contacts, walls, spins,
-- off track, stopped cars), and the Live tab lists everything happening right
-- now, including what doesn't pop up, with a Show button for each. Off track
-- comes from the website (the game can't judge it for other cars).
--
-- v1.5: called NABS Race Control now, with the league logo, and the chime has
-- a volume.
--
-- v1.6: the cameras follow the car round corners (they used to keep the
-- direction from the moment of the incident), and four more views: onboard,
-- from the front, helicopter, and the crash scene, which stays on the spot.

---------------------------------------------------------------------------------------------------
-- Settings (saved automatically)
---------------------------------------------------------------------------------------------------

local S = ac.storage({
  enabled = true,
  maxPip = 2,           -- cards on screen at once (1 to 4)
  width = 400,          -- width of one camera tile in pixels
  viewTop = true,       -- camera tiles per incident, side by side
  viewChase = false,
  viewSide = false,
  viewTrack = true,
  viewTcam = false,
  viewFront = false,
  viewHeli = false,
  viewScene = false,
  chaseDist = 8,        -- metres behind the car for the chase view
  stopKmh = 8,          -- below this a car counts as stopped
  holdSec = 3,          -- how long it has to stand before it's reported
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
  soundOn = true,       -- a short chime when a contact card pops up
  soundVolume = 80,     -- percent
  pileups = true,       -- several cars crashing in one place = one card
  -- what comes on screen by itself (everything is listed in the window anyway)
  popContact = true,
  carMinKmh = 0,        -- ...only from this speed (0 = all the website sends)
  popWall = true,
  wallMinKmh = 0,
  popSpin = true,
  popOfftrack = false,  -- happens a lot; listed, shown on request
  popStopped = true,
  -- seconds a card stays (0 = until you close it). Stopped and off track count
  -- from the moment it is over (driving again, back on the tarmac).
  keepContact = 20,
  keepPileup = 30,
  keepWall = 15,
  keepSpin = 10,
  keepOfftrack = 3,
  keepStopped = 5,
}, 'nabsHud1_')

-- The order matters: aimShot picks the camera by this number.
local VIEWS = {
  { key = 'viewTop', name = 'From above', short = 'TOP', tip = 'Like a drone behind and above the car.' },
  { key = 'viewChase', name = 'Chase', short = 'CHASE', tip = 'Behind the car, follows it round the corners.' },
  { key = 'viewSide', name = 'Side', short = 'SIDE', tip = 'Next to the car, at its height.' },
  { key = 'viewTrack', name = 'TV camera', short = 'TV CAM', tip = 'The track\'s own TV cameras, as in a replay.' },
  { key = 'viewTcam', name = 'Onboard', short = 'ONBOARD', tip = 'Just above the driver, looking where the car points (turns with a spin).' },
  { key = 'viewFront', name = 'From the front', short = 'FRONT', tip = 'Ahead of the car looking back at it: front wing, what is behind.' },
  { key = 'viewHeli', name = 'Helicopter', short = 'HELI', tip = 'High and far back: the cars around it, the whole corner.' },
  { key = 'viewScene', name = 'Crash scene', short = 'SCENE', tip = 'Stays where it happened, even when the car drives away. Good for pile-ups.' },
}
local APP_VERSION = '1.6'
local LOGO = __dirname .. '/logo.png'
local KIND_LABEL = { stopped = 'CAR STOPPED', spin = 'SPIN', test = 'TEST', contact = 'CONTACT', wall = 'WALL', pileup = 'PILE-UP', offtrack = 'OFF TRACK' }
local OVER_LABEL = { stopped = 'MOVING AGAIN', offtrack = 'BACK ON TRACK' }
local KIND_COLOR = {
  stopped = rgbm(0.9, 0.28, 0.3, 1),
  spin = rgbm(0.96, 0.65, 0.14, 1),
  test = rgbm(0.24, 0.61, 1, 1),
  contact = rgbm(0.94, 0.27, 0.27, 1),
  wall = rgbm(1, 0.52, 0.12, 1),
  pileup = rgbm(0.78, 0.2, 0.62, 1),
  offtrack = rgbm(0.98, 0.8, 0.2, 1),
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

-- What comes on screen by itself, and how long a card stays. Everything is
-- detected and listed in the window either way; these only decide the screen.
local POP_KEY = { contact = 'popContact', pileup = 'popContact', wall = 'popWall', spin = 'popSpin', offtrack = 'popOfftrack', stopped = 'popStopped' }
local KEEP_KEY = { contact = 'keepContact', pileup = 'keepPileup', wall = 'keepWall', spin = 'keepSpin', offtrack = 'keepOfftrack', stopped = 'keepStopped' }
-- One entry per car; when something new happens to a car that already has one,
-- the more important of the two wins.
local RANK = { test = 0, offtrack = 1, spin = 2, wall = 3, contact = 4, pileup = 5, stopped = 6 }

local function popsUp(kind)
  local key = POP_KEY[kind]
  return key == nil or S[key] == true
end

-- `pop` overrides the per-kind setting (a contact under the speed filter is
-- listed but doesn't pop up). Returns the car's entry.
local function raise(i, kind, car, detail, pop)
  local inc = incidents[i]
  if inc and not inc.resolved and kind ~= 'test' and inc.kind ~= 'test' then
    if kind == 'stopped' and inc.kind == 'spin' then
      -- A spin that ends standing still becomes "stopped" on the same card.
      inc.kind = 'stopped'
      inc.lastSeen = clock
      inc.detail = nil
      if popsUp('stopped') then inc.show = true end
      addLog(driverName(i) .. ' stopped after a spin')
      return inc
    end
    if kind == inc.kind or (RANK[kind] or 0) < (RANK[inc.kind] or 0) then
      -- Still the same thing, or something smaller: the entry stays, it's alive.
      inc.lastSeen = clock
      if kind == inc.kind and detail then inc.detail = detail end
      return inc
    end
  end
  local show
  if pop == nil then show = popsUp(kind) else show = pop end
  -- A card already on screen for this car stays there with the new news.
  if inc and inc.show and not inc.resolved then show = true end
  local hx, hz = heading(car)
  local cp = car.position
  inc = {
    car = i, kind = kind, since = clock, lastSeen = clock, hx = hx, hz = hz, detail = detail,
    show = show or kind == 'test', manual = kind == 'test',
    startPos = { x = cp.x, y = cp.y, z = cp.z },
  }
  incidents[i] = inc
  addLog(driverName(i) .. '  ' .. (KIND_LABEL[kind] or kind) .. (detail and ('  ' .. detail) or ''))
  return inc
end

-- Over: a stopped car driving again, an off track back on the tarmac.
local function resolve(inc)
  if inc and not inc.resolved then
    inc.resolved = true
    inc.resolvedAt = clock
  end
end

-- Cards close by themselves once their time is up (0 = stays until closed).
-- Stopped cars and off tracks count from the moment they are over; a card
-- opened by hand stays until it is hidden or closed by hand.
local function expireIncidents()
  for i, inc in pairs(incidents) do
    if not inc.manual then
      local keep = S[KEEP_KEY[inc.kind] or ''] or 0
      if keep > 0 then
        local from
        if inc.kind == 'stopped' or inc.kind == 'offtrack' then
          from = inc.resolved and inc.resolvedAt or nil
        else
          from = math.max(inc.lastHit or inc.since, inc.lastSeen or inc.since)
        end
        if from and clock - from > keep then incidents[i] = nil end
      end
    end
  end
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

-- The chime. Loaded on first use; at most one every 1.5 s, a pile-up is one sound.
local alertPlayer, lastAlert = nil, -10
local function playAlert(force)
  if not force and (not S.soundOn or clock - lastAlert < 1.5) then return end
  lastAlert = clock
  pcall(function()
    local volume = math.max(0, math.min(100, S.soundVolume)) / 100
    if not alertPlayer then
      alertPlayer = ui.MediaPlayer(__dirname .. '/alert.wav', { use3D = false })
      alertPlayer:setVolume(volume)
      alertPlayer:setAutoPlay(true) -- the first time it plays once it has loaded
      return
    end
    alertPlayer:setVolume(volume)
    alertPlayer:setCurrentTime(0)
    alertPlayer:play()
  end)
end

-- A crash near a card that is still fresh joins that card instead of opening
-- another one: several cars in one corner within a few seconds is one incident.
local PILE_WINDOW = 4   -- seconds since the card's last hit
local PILE_RADIUS = 60  -- metres

local function nearbyCrash(pos)
  if not pos or not pos.x then return nil end
  for _, inc in pairs(incidents) do
    if inc.crashPos and clock - (inc.lastHit or -99) <= PILE_WINDOW then
      local dx, dz = inc.crashPos.x - pos.x, inc.crashPos.z - pos.z
      if dx * dx + dz * dz <= PILE_RADIUS * PILE_RADIUS then return inc end
    end
  end
  return nil
end

local function addNames(inc, ...)
  inc.nameList = inc.nameList or {}
  inc.names = inc.names or {}
  for _, n in ipairs({ ... }) do
    if n and n ~= '' and not inc.names[string.lower(n)] then
      inc.names[string.lower(n)] = true
      table.insert(inc.nameList, n)
    end
  end
end

local function shorten(text, max)
  if #text <= max then return text end
  return string.sub(text, 1, max - 3) .. '...'
end

local function onContact(ev)
  local isCar = ev.kind == 'car'
  if get(ac.getSim(), 'isReplayActive', false) then return end
  local i, car = localCarFor(ev.carId, ev.driver)
  if i == nil or not car then return end
  if S.ignoreOwn and i == 0 then return end
  local minKmh = isCar and S.carMinKmh or S.wallMinKmh
  local pop = (isCar and S.popContact or (not isCar and S.popWall)) and not (ev.kmh and minKmh > 0 and ev.kmh < minKmh)

  if S.pileups then
    local inc = nearbyCrash(ev.pos)
    if inc then
      addNames(inc, ev.driver, isCar and ev.other or nil)
      inc.lastHit = clock
      if #inc.nameList >= 3 then
        if inc.kind ~= 'pileup' then
          addLog('Pile-up: ' .. table.concat(inc.nameList, ', '))
          if S.popContact and not inc.show then
            inc.show = true
            playAlert()
          end
        end
        inc.kind = 'pileup'
        inc.detail = shorten(#inc.nameList .. ' cars: ' .. table.concat(inc.nameList, ', '), 60)
      end
      return
    end
  end

  local kmh = ev.kmh and string.format('%d km/h', math.floor(ev.kmh + 0.5)) or nil
  local detail = kmh
  if isCar and ev.other then detail = (kmh and (kmh .. ', ') or '') .. 'with ' .. ev.other end
  local inc = raise(i, isCar and 'contact' or 'wall', car, detail, pop)
  if inc and (inc.kind == 'contact' or inc.kind == 'wall') then
    inc.crashPos = ev.pos
    inc.lastHit = clock
    inc.nameList, inc.names = nil, nil
    addNames(inc, ev.driver or driverName(i), isCar and ev.other or nil)
  end
  if pop then playAlert() end
end

-- Off track, judged by the website from the track map.
local function onOfftrack(ev)
  if get(ac.getSim(), 'isReplayActive', false) then return end
  local i, car = localCarFor(ev.carId, ev.driver)
  if i == nil or not car then return end
  if S.ignoreOwn and i == 0 then return end
  if ev.ended then
    local inc = incidents[i]
    if inc and inc.kind == 'offtrack' then resolve(inc) end
    return
  end
  raise(i, 'offtrack', car, ev.metres and string.format('%d m off the tarmac', math.floor(ev.metres + 0.5)) or nil)
end

local function pollWebsite()
  if net.busy or not S.rcOn or S.rcCode == '' or clock < net.retryAt then return end
  if not web or not web.get then
    net.status = 'no web in this CSP'
    return
  end
  local url = S.rcUrl .. '/api/race-control/app/next?code=' .. S.rcCode
  if net.cursor ~= nil then url = url .. '&after=' .. net.cursor .. '&wait=20&with=offtrack' end
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
      pcall(ev.kind == 'offtrack' and onOfftrack or onContact, ev)
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
  if speed > 15 then
    local v = car.velocity
    local vl = math.sqrt(v.x * v.x + v.z * v.z)
    local hx, hz = heading(car)
    if vl > 0.1 then
      local cosAngle = (v.x * hx + v.z * hz) / vl
      if cosAngle < 0.34 then st.spinT = st.spinT + dt else st.spinT = 0 end  -- mehr als ca. 70 Grad
      if st.spinT > 0.2 then raise(i, 'spin', car) end
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
        resolve(inc)
        addLog(driverName(i) .. ' moving again')
      end
    else
      inc.clearT = 0
    end
  end
end

function script.update(dt)
  clock = clock + dt
  pollWebsite() -- keeps listening in a pause or a replay too
  expireIncidents()
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
  for k = 1, 4 do
    if k > maxPip or (slots[k] ~= nil and not (incidents[slots[k]] and incidents[slots[k]].show)) then slots[k] = nil end
  end
  local shown = {}
  for k = 1, maxPip do if slots[k] ~= nil then shown[slots[k]] = true end end

  local waiting = {}
  for i, inc in pairs(incidents) do
    if inc.show and not shown[i] then table.insert(waiting, inc) end
  end
  table.sort(waiting, function(a, b) return a.since > b.since end)

  for k = 1, maxPip do
    if slots[k] == nil and #waiting > 0 then
      slots[k] = table.remove(waiting, 1).car
    end
  end

  -- All spots taken and something newer is waiting: it takes the spot of the
  -- oldest card on screen, so the latest crash is always visible. The older
  -- card stays in the list in the window.
  while #waiting > 0 do
    local oldestK, oldestSince = nil, math.huge
    for k = 1, maxPip do
      local inc = slots[k] ~= nil and incidents[slots[k]] or nil
      if inc and inc.since < oldestSince then oldestK, oldestSince = k, inc.since end
    end
    if not oldestK or waiting[1].since <= oldestSince then break end
    slots[oldestK] = table.remove(waiting, 1).car
  end
end

-- Where the cameras look along: the way the car is going, smoothed. It swings
-- round a corner with the car, and doesn't whip round in a spin, because a
-- spinning car keeps sliding the same way. Standing still keeps the last one.
local function followHeading(inc, car)
  local v = car.velocity
  local vl = math.sqrt(v.x * v.x + v.z * v.z)
  local fx, fz = inc.fx or inc.hx, inc.fz or inc.hz
  if vl > 3 then
    local dt = math.max(0, clock - (inc.fT or clock))
    local k = 1 - math.exp(-dt * 3)
    fx, fz = fx + (v.x / vl - fx) * k, fz + (v.z / vl - fz) * k
    local l = math.sqrt(fx * fx + fz * fz)
    if l > 0.001 then fx, fz = fx / l, fz / l end
  end
  inc.fx, inc.fz, inc.fT = fx, fz, clock
  return fx, fz
end

local function aimShot(shot, inc, view)
  local car = ac.getCar(inc.car)
  if not car then return end
  local p = car.position

  if view == 4 then
    local ok = pcall(function() shot:updateWithTrackCamera(inc.car) end)
    if ok then return end
    view = 2 -- a CSP without track cameras: chase instead
  end

  local hx, hz = followHeading(inc, car)
  local up = vec3(0, 1, 0)
  local cx, cy, cz, tx, ty, tz, fov
  if view == 1 then
    -- above and behind, like a drone
    cx, cy, cz = p.x - hx * 10, p.y + 24, p.z - hz * 10
    tx, ty, tz = p.x, p.y, p.z
    fov = 45
  elseif view == 3 then
    -- beside the car, at its height (on its right)
    local sx, sz = hz, -hx
    cx, cy, cz = p.x + sx * 9, p.y + 1.6, p.z + sz * 9
    tx, ty, tz = p.x, p.y + 0.6, p.z
    fov = 55
  elseif view == 5 and get(car, 'look', nil) and get(car, 'up', nil) then
    -- onboard: just above and behind the driver, along the car itself
    local lk, u = car.look, car.up
    cx, cy, cz = p.x - lk.x * 0.6 + u.x * 1.25, p.y - lk.y * 0.6 + u.y * 1.25, p.z - lk.z * 0.6 + u.z * 1.25
    tx, ty, tz = cx + lk.x * 10, cy + lk.y * 10, cz + lk.z * 10
    up = vec3(u.x, u.y, u.z)
    fov = 70
  elseif view == 6 then
    -- ahead of the car, looking back at it
    cx, cy, cz = p.x + hx * 9, p.y + 1.8, p.z + hz * 9
    tx, ty, tz = p.x, p.y + 0.6, p.z
    fov = 50
  elseif view == 7 then
    -- helicopter: high and far back, the corner and the cars around
    cx, cy, cz = p.x - hx * 35, p.y + 45, p.z - hz * 35
    tx, ty, tz = p.x + hx * 10, p.y, p.z + hz * 10
    fov = 50
  elseif view == 8 then
    -- the crash scene: fixed where it happened, from behind and to the side
    local sp = inc.crashPos or inc.startPos or p
    local sy = sp.y or p.y
    cx, cy, cz = sp.x - inc.hx * 18 + inc.hz * 10, sy + 12, sp.z - inc.hz * 18 - inc.hx * 10
    tx, ty, tz = sp.x, sy, sp.z
    fov = 50
  else
    -- chase: behind the car
    local d = math.max(3, S.chaseDist)
    cx, cy, cz = p.x - hx * d, p.y + d * 0.4, p.z - hz * d
    tx, ty, tz = p.x, p.y + 0.8, p.z
    fov = 55
  end

  local dx, dy, dz = tx - cx, ty - cy, tz - cz
  local l = math.sqrt(dx * dx + dy * dy + dz * dz)
  if l < 0.001 then return end
  shot:update(vec3(cx, cy, cz), vec3(dx / l, dy / l, dz / l), up, fov)
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
  -- the league logo where the live dot used to be
  local okLogo = pcall(ui.drawImage, LOGO, vec2(4, 3), vec2(4 + TITLE_H - 6, TITLE_H - 3))
  if not okLogo then ui.drawCircleFilled(vec2(12, TITLE_H / 2), 4, rgbm(0.9, 0.2, 0.22, 1), 16) end
  ui.pushFont(ui.Font.Small)
  ui.setCursor(vec2(TITLE_H + 4, 4))
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
  local tag = resolved and (OVER_LABEL[inc.kind] or 'OVER') or (KIND_LABEL[inc.kind] or '')
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

-- A tooltip for the control drawn just before.
local function hint(text)
  if ui.itemHovered() then ui.setTooltip(text) end
end

local function toggle(label, key, tip)
  if ui.checkbox(label, S[key]) then S[key] = not S[key] end
  if tip then hint(tip) end
end

local function note(text)
  ui.pushFont(ui.Font.Small)
  ui.textWrapped(text)
  ui.popFont()
end

local GOOD = rgbm(0.3, 0.78, 0.5, 1)
local BAD = rgbm(0.95, 0.38, 0.35, 1)

-- Where the connection to the website stands, in words and a colour.
local function connectionState()
  if not S.rcOn then return 'Off', TEXT_DIM end
  if S.rcCode == '' then return 'No code yet', TEXT_DIM end
  if net.status == 'connected' then return 'Connected', GOOD end
  if net.status == 'connecting' or net.status == 'off' then return 'Connecting...', TEXT_DIM end
  return net.status:sub(1, 1):upper() .. net.status:sub(2), BAD
end

local function tabLive()
  ui.header('Website')
  toggle('Get contacts from nabsracing.com', 'rcOn',
    'The race server reports every collision to the website, and the website passes it on to this app within about half a second.')
  local okInput, value = pcall(ui.inputText, 'Pairing code', S.rcCode)
  if okInput and type(value) == 'string' then
    local clean = string.upper(value):gsub('[^A-Z0-9]', '')
    if clean ~= S.rcCode then
      S.rcCode = clean
      net.cursor, net.retryAt, net.fails = nil, 0, 0
      net.status = clean == '' and 'off' or 'connecting'
    end
  end
  hint('Six characters. You find it on nabsracing.com under Admin > Race control.')
  local text, col = connectionState()
  ui.textColored(text .. (net.lastAt and ('   last contact ' .. net.lastAt) or ''), col)
  if S.rcCode == '' then
    note('Get your code on nabsracing.com under Admin > Race control and type it in above. You only do this once, it is kept.')
  end

  -- everything happening right now, on screen or not
  local list = {}
  for _, inc in pairs(incidents) do table.insert(list, inc) end
  table.sort(list, function(a, b) return a.since > b.since end)
  local onScreen = 0
  for _, inc in ipairs(list) do if inc.show then onScreen = onScreen + 1 end end

  ui.header('Happening now' .. (#list > 0 and (' (' .. #list .. ')') or ''))
  if #list == 0 then
    note('Nothing right now. Everything the app spots is listed here, and what you picked under Pop-ups also comes on screen by itself.')
  end
  for _, inc in ipairs(list) do
    if ui.button('x##close' .. inc.car, vec2(22, 0)) then clearIncident(inc.car) end
    hint('Remove it from the list')
    ui.sameLine()
    if ui.button((inc.show and 'Hide' or 'Show') .. '##vis' .. inc.car, vec2(46, 0)) then
      inc.show = not inc.show
      inc.manual = inc.show -- opened by hand: stays until you hide or close it
    end
    hint(inc.show and 'Take the camera card off the screen. It stays in this list.' or 'Put the camera card for this car on screen.')
    ui.sameLine()
    local col2 = inc.resolved and RESOLVED_COLOR or (KIND_COLOR[inc.kind] or rgbm(1, 1, 1, 1))
    ui.textColored(inc.resolved and (OVER_LABEL[inc.kind] or 'OVER') or (KIND_LABEL[inc.kind] or ''), col2)
    ui.sameLine()
    if inc.show then ui.text(driverName(inc.car)) else ui.textColored(driverName(inc.car), TEXT_DIM) end
    if inc.detail then
      ui.sameLine()
      ui.textColored(inc.detail, TEXT_DIM)
    end
  end
  if #list > 1 and ui.button('Clear the list') then
    for i in pairs(incidents) do clearIncident(i) end
  end
  if #list > 0 then
    local maxPip = math.floor(S.maxPip)
    local text = onScreen .. ' of these on screen'
    if onScreen > maxPip then text = text .. ', room for ' .. maxPip .. ' (the newest win)' end
    ui.textColored(text, TEXT_DIM)
  end
end

-- One kind: does it pop up by itself, and how long does its card stay.
local function kindRow(label, popKey, keepKey, keepText, tip)
  toggle(label, popKey, tip)
  local k = S[keepKey]
  slider('##' .. keepKey, keepKey, 0, 120, k < 1 and '  card stays until you close it' or keepText)
end

local function tabAlerts()
  ui.header('Sound')
  toggle('Play a sound on contacts', 'soundOn', 'A short chime when a contact or pile-up card pops up.')
  ui.sameLine()
  if ui.button('Test##sound') then playAlert(true) end
  if S.soundOn then slider('##volume', 'soundVolume', 0, 100, '  volume %.0f %%') end

  ui.header('What pops up by itself')
  note('Ticked kinds come on screen by themselves. Everything else is still listed under Live, with a Show button.')
  kindRow('Car against car', 'popContact', 'keepContact', '  card closes %.0f s after the hit')
  if S.popContact then slider('##carMin', 'carMinKmh', 0, 150, S.carMinKmh < 1 and '  from any speed' or '  only from %.0f km/h') end
  kindRow('Car against wall', 'popWall', 'keepWall', '  card closes %.0f s after the hit')
  if S.popWall then slider('##wallMin', 'wallMinKmh', 0, 200, S.wallMinKmh < 1 and '  from any speed' or '  only from %.0f km/h') end
  kindRow('Spins', 'popSpin', 'keepSpin', '  card closes %.0f s after the spin',
    'A car pointing well away from where it is going.')
  kindRow('Off track', 'popOfftrack', 'keepOfftrack', '  card closes %.0f s after it is back',
    'All four wheels about off the tarmac, judged by the website from the track map. Happens a lot, so it is off by default.')
  kindRow('Stopped cars', 'popStopped', 'keepStopped', '  card closes %.0f s after it drives on',
    'A car standing on track (not in the pit lane).')
  slider('##hold', 'holdSec', 1, 10, '  counts as stopped after %.0f s')

  ui.header('More')
  toggle('One card for a pile-up', 'pileups',
    'Several cars crashing in the same spot within a few seconds become one PILE-UP card instead of one card each.')
  if S.pileups then slider('##keepPile', 'keepPileup', 0, 120, S.keepPileup < 1 and '  pile-up card stays until you close it' or '  pile-up card closes %.0f s after the last hit') end
  toggle('Ignore my own car', 'ignoreOwn')
  note('The website already drops tiny contacts for everyone (the km/h setting on the TV board).')
end

local function tabCameras()
  ui.header('Views on each card')
  for _, view in ipairs(VIEWS) do toggle(view.name, view.key, view.tip) end
  if S.viewChase then slider('##chaseDist', 'chaseDist', 4, 20, '  chase camera %.0f m behind') end
  note('Each card shows the ticked views side by side, so more views make the cards wider. At least one is always on.')

  ui.header('Cards')
  slider('##maxPip', 'maxPip', 1, 4, 'Up to %.0f cards on screen')
  slider('##width', 'width', 240, 640, 'Each view %.0f px wide')
  slider('##fps', 'fps', 5, 60, 'Refresh %.0f times a second')
  hint('Lower is easier on your frame rate.')
  slider('##posX', 'posX', 0, 3000, 'Left edge at %.0f px', true)
  slider('##posY', 'posY', 0, 2000, 'Top edge at %.0f px', true)
  if ui.button('Show a test card') then
    local count = get(ac.getSim(), 'carsCount', 1)
    testCursor = (testCursor + 1) % math.max(count, 1)
    local car = ac.getCar(testCursor)
    if car then
      clearIncident(testCursor)
      raise(testCursor, 'test', car)
    end
  end
  hint('Opens a card for the next car, to check where the cards sit.')
end

local function tabPicture()
  ui.header('Brightness')
  toggle('Automatic exposure', 'autoExposure', 'Adjusts each picture like a camera would.')
  slider('##exposure', 'exposure', 0.2, 4, 'Exposure %.2fx', 2)
  slider('##shadowLift', 'shadowLift', 0, 1, 'Brighter shadows %.2f')
  toggle('Gamma correction', 'gamma')
  ui.header('Quality')
  if ui.checkbox('Fast (simpler shading, more fps)', math.floor(S.quality) == 2) then
    S.quality = math.floor(S.quality) == 2 and 1 or 2
  end
  toggle('Own shadows per view (costs fps)', 'ownShadows')
end

function script.windowMain(dt)
  -- one line on top that says whether the website link works
  local text, col = connectionState()
  pcall(ui.image, LOGO, vec2(18, 18))
  ui.sameLine(0, 6)
  ui.pushFont(ui.Font.Small)
  ui.textColored('NABS Race Control', rgbm(1, 1, 1, 1))
  hint('Version ' .. APP_VERSION)
  ui.sameLine(0, 12)
  ui.textColored('Website: ' .. text, col)
  ui.popFont()

  ui.tabBar('nabsRcTabs', function()
    ui.tabItem('Live', tabLive)
    ui.tabItem('Pop-ups', tabAlerts)
    ui.tabItem('Cameras', tabCameras)
    ui.tabItem('Picture', tabPicture)
  end)
end
