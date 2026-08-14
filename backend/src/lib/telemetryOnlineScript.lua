--------------------------------------------------------------------------------
-- nabsTelemetry, the server-delivered flavour.
--
-- This file is TEMPLATED: the site serves it at
-- /api/telemetry-laps/app.lua?key=... with __INGEST_URL__ replaced by the real
-- ingest address (key included). The league server's csp_extra_options points
-- a [SCRIPT_...] section at that URL, CSP hands the script to every driver who
-- joins, and it runs in their game with no install, no window, no settings —
-- which is the whole point: the drivers do nothing.
--
-- Same recording logic as ac-apps/nabsTelemetry (the hand-installed app for
-- testing), minus everything that needed a window: it samples speed, throttle,
-- brake, steering and gear over each lap by TRACK POSITION (N equal slices of
-- the spline), and posts a lap only when it is clean — no four-wheels-off, no
-- pit lane, fully recorded — and faster than anything already sent this
-- session. The site keeps one lap per driver per track (their fastest) and
-- answers slower posts with "kept: false", so re-posting costs nothing.
--
-- Transparency: the one visible thing it does is a toast on first lap start,
-- so nobody's inputs are recorded without the screen having said so. Every
-- engine call is pcall-guarded — an API this build doesn't have must degrade
-- to "no recording", never to a broken session.
--------------------------------------------------------------------------------

local INGEST_URL = "__INGEST_URL__"
local N = 800

local sim = ac.getSim()
local rec = nil
local bestSentMs = nil
local announced = false

local function safeCall(fn, fallback)
  local ok, v = pcall(fn)
  if ok and v ~= nil and v ~= "" then return v end
  return fallback
end

local IDENT = nil
local function identity()
  if IDENT then return IDENT end
  local track = safeCall(function() return ac.getTrackID() end, "unknown")
  local full = safeCall(function() return ac.getTrackFullID("|") end, track)
  local layout = ""
  local cut = string.find(full or "", "|", 1, true)
  if cut then layout = string.sub(full, cut + 1) end
  IDENT = {
    steamId = tostring(safeCall(function() return ac.getUserSteamID() end, "")),
    name = tostring(safeCall(function() return ac.getDriverName(0) end, "driver")),
    car = tostring(safeCall(function() return ac.getCarID(0) end, "unknown")),
    track = tostring(track),
    layout = tostring(layout),
  }
  return IDENT
end

local function newRec(lapCount)
  return {
    lap = lapCount, lastBucket = -1, filled = 0, dirty = false, pit = false,
    t = {}, speed = {}, gas = {}, brake = {}, steer = {}, gear = {}, x = {}, z = {},
  }
end

local function sampleInto(r, car)
  if car.isInPitlane or car.isInPit then r.pit = true end
  if (car.wheelsOutside or 0) >= 4 then r.dirty = true end

  local pos = car.splinePosition or 0
  if pos < 0 then pos = 0 elseif pos >= 1 then pos = 0.999999 end
  local bucket = math.floor(pos * N)
  if bucket <= r.lastBucket then return end
  if bucket - r.lastBucket > N / 2 and r.lastBucket >= 0 then
    r.lastBucket = bucket
    return
  end

  local t = math.floor(car.lapTimeMs or 0)
  local speed = math.floor((car.speedKmh or 0) + 0.5)
  local gas = math.floor((car.gas or 0) * 100 + 0.5)
  local brake = math.floor((car.brake or 0) * 100 + 0.5)
  local steer = math.floor((car.steer or 0) * 10 + 0.5)
  local gear = math.floor(car.gear or 0)
  -- World position in decimetres: the site draws the track map FROM the lap,
  -- so no track files are ever needed. pcall-free field reads with fallbacks,
  -- like everything else here.
  local px, pz = 0, 0
  if car.position ~= nil then
    px = math.floor((car.position.x or 0) * 10 + 0.5)
    pz = math.floor((car.position.z or 0) * 10 + 0.5)
  end
  for b = r.lastBucket + 1, bucket do
    local i = b + 1
    r.t[i] = t; r.speed[i] = speed; r.gas[i] = gas; r.brake[i] = brake
    r.steer[i] = steer; r.gear[i] = gear; r.x[i] = px; r.z[i] = pz
    r.filled = r.filled + 1
  end
  r.lastBucket = bucket
end

local function postLap(r, lapMs)
  local id = identity()
  if id.steamId == "" then return end
  local lastIdx = 0
  for i = N, 1, -1 do if r.t[i] ~= nil then lastIdx = i break end end
  if lastIdx == 0 then return end
  for i = 1, N do
    if r.t[i] == nil then
      local src = (i > lastIdx) and lastIdx or nil
      if src == nil then
        local j = i - 1
        while j >= 1 and r.t[j] == nil do j = j - 1 end
        src = (j >= 1) and j or lastIdx
      end
      r.t[i] = r.t[src]; r.speed[i] = r.speed[src]; r.gas[i] = r.gas[src]
      r.brake[i] = r.brake[src]; r.steer[i] = r.steer[src]; r.gear[i] = r.gear[src]
      r.x[i] = r.x[src]; r.z[i] = r.z[src]
    end
  end

  local payload = {
    v = 1, steamId = id.steamId, name = id.name, car = id.car,
    track = id.track, layout = id.layout, lapTimeMs = lapMs, n = N,
    t = r.t, speed = r.speed, gas = r.gas, brake = r.brake, steer = r.steer, gear = r.gear,
    x = r.x, z = r.z,
  }
  web.post(INGEST_URL, { ['Content-Type'] = "application/json" }, JSON.stringify(payload), function (err, response)
    if err then
      ac.debug("nabsTelemetry post error", tostring(err))
      return
    end
    ac.debug("nabsTelemetry post", "HTTP " .. tostring(response and response.status or 0))
  end)
end

local function finishLap(r, lapMs)
  local clean = (lapMs or 0) > 0 and not r.dirty and not r.pit and r.filled >= N * 0.9
  if clean and (bestSentMs == nil or lapMs < bestSentMs) then
    postLap(r, lapMs)
    bestSentMs = lapMs
  end
end

function script.update(dt)
  local ok, err = pcall(function()
    if sim.isReplayActive then return end
    local car = ac.getCar(0)
    if car == nil then return end

    -- Said once, on screen, before anything is recorded. pcall'd: a CSP old
    -- enough to lack toasts simply skips the announcement, not the courtesy —
    -- the league announces the recording in Discord as well.
    if not announced then
      announced = true
      pcall(function()
        ui.toast(ui.Icons.Stopwatch, "NABS telemetry: your fastest clean lap is sent to nabsracing.com")
      end)
    end

    local lc = car.lapCount or 0
    if rec == nil then
      rec = newRec(lc)
    elseif lc ~= rec.lap then
      if lc == rec.lap + 1 then finishLap(rec, math.floor(car.previousLapTimeMs or 0)) end
      rec = newRec(lc)
    end
    sampleInto(rec, car)
  end)
  if not ok then ac.debug("nabsTelemetry update error", tostring(err)) end
end
