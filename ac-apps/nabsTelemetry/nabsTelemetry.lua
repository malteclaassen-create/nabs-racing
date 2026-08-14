--------------------------------------------------------------------------------
-- nabsTelemetry — records what only the driver's PC can see.
--
-- The race server hands the league lap times, sectors and top speeds; it never
-- sees throttle, brake or steering, because those exist only inside the sim on
-- this machine. This app samples them over each lap and posts the driver's
-- FASTEST clean lap to the league website, where two drivers' laps can be laid
-- over each other pedal for pedal.
--
-- Built on the same rails as webPenaltyNABS, and with its hard-won lessons:
--   * nothing at the top level may throw (a thrown chunk = a silent grey
--     window with no error anywhere), so everything engine-touching is pcall'd;
--   * both window functions run their body behind a pcall and PRINT the error
--     where the content would be;
--   * web.post's callback guards err/response, because a timeout otherwise
--     throws inside a callback where nobody sees it.
--
-- SAMPLING: by track position, not by time. The lap is divided into N equal
-- slices of the spline (0..1); each slice stores the values as the car crosses
-- into it. Two laps recorded this way line up slice-for-slice, so the website
-- can subtract them without interpolating anything.
--
-- WHAT COUNTS AS CLEAN, first version, written down so it can be argued with:
--   * four wheels off track at any point -> dirty (not sent);
--   * any part of the lap in the pit lane -> not sent;
--   * fewer than 90% of slices filled (joined mid-lap, teleport) -> not sent.
-- By default only a lap FASTER than the fastest already sent this session goes
-- out; the website keeps only the fastest per driver per track anyway.
--------------------------------------------------------------------------------

local stored = ac.storage{
  -- The league URL, printed by Admin -> Reports -> "Telemetry from inside the
  -- car" -> Switch on and make a key. Nothing is sent anywhere else.
  url = "",
  enabled = false,
  -- Off: send every clean lap and let the site keep the fastest. On (default):
  -- only send when this session's own best is beaten — fewer posts, same result.
  onlyBest = true,
}

local BUILD = "nabs telemetry build 1"
local N = 800 -- slices per lap; ~30-60 KB of JSON per posted lap

local sim = ac.getSim()

-- Session state ---------------------------------------------------------------
local rec = nil          -- the lap being recorded (see newRec)
local bestSentMs = nil   -- fastest lap posted this session
local lastLap = nil      -- { ms, clean, sent, note } for the status line
local lastSend = nil     -- { ok, text, at }

-- Identity, read once and defensively: every one of these is an engine call
-- that may not exist on an older CSP, and none of them may kill the chunk.
local function safeCall(fn, fallback)
  local ok, v = pcall(fn)
  if ok and v ~= nil and v ~= "" then return v end
  return fallback
end

local IDENT = nil
local function identity()
  if IDENT then return IDENT end
  local track = safeCall(function() return ac.getTrackID() end, "unknown")
  -- getTrackFullID("|") comes back "track|layout" when the track has layouts
  -- and just "track" when it hasn't; the layout is whatever follows the bar.
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

-- Recording -------------------------------------------------------------------
local function newRec(lapCount)
  return {
    lap = lapCount,
    lastBucket = -1,
    filled = 0,
    dirty = false,
    pit = false,
    t = {}, speed = {}, gas = {}, brake = {}, steer = {}, gear = {},
  }
end

local function sampleInto(r, car)
  if car.isInPitlane or car.isInPit then r.pit = true end
  if (car.wheelsOutside or 0) >= 4 then r.dirty = true end

  local pos = car.splinePosition or 0
  if pos < 0 then pos = 0 elseif pos >= 1 then pos = 0.999999 end
  local bucket = math.floor(pos * N)
  if bucket <= r.lastBucket then return end
  -- A jump backwards by more than half the track is a reset/teleport, not
  -- driving; the 90%-filled rule will throw the lap out via the gap.
  if bucket - r.lastBucket > N / 2 and r.lastBucket >= 0 then
    r.lastBucket = bucket
    return
  end

  -- Values once, then written into every slice crossed this frame — at 60fps
  -- and N=800 that is almost always exactly one.
  local t = math.floor(car.lapTimeMs or 0)
  local speed = math.floor((car.speedKmh or 0) + 0.5)
  local gas = math.floor((car.gas or 0) * 100 + 0.5)
  local brake = math.floor((car.brake or 0) * 100 + 0.5)
  local steer = math.floor((car.steer or 0) * 10 + 0.5) -- tenths of a degree
  local gear = math.floor(car.gear or 0)
  for b = r.lastBucket + 1, bucket do
    local i = b + 1 -- Lua arrays are 1-based; the wire format is 0-based slices
    r.t[i] = t; r.speed[i] = speed; r.gas[i] = gas; r.brake[i] = brake
    r.steer[i] = steer; r.gear[i] = gear
    r.filled = r.filled + 1
  end
  r.lastBucket = bucket
end

-- Sending ---------------------------------------------------------------------
local function pingUrl()
  if stored.url == "" then return nil end
  local sep = string.find(stored.url, "?", 1, true) and "&" or "?"
  return stored.url .. sep .. "ping=1"
end

local function postLap(r, lapMs)
  local id = identity()
  -- Fill the tail: a lap ends ON the line, so the last slice or two may not
  -- have been crossed when lapCount ticked. Repeat the final sample.
  local lastIdx = 0
  for i = N, 1, -1 do if r.t[i] ~= nil then lastIdx = i break end end
  if lastIdx == 0 then return end
  for i = 1, N do
    if r.t[i] == nil then
      local src = (i > lastIdx) and lastIdx or nil
      -- Gaps in the middle take the previous slice; gaps at the tail the last.
      if src == nil then
        local j = i - 1
        while j >= 1 and r.t[j] == nil do j = j - 1 end
        src = (j >= 1) and j or lastIdx
      end
      r.t[i] = r.t[src]; r.speed[i] = r.speed[src]; r.gas[i] = r.gas[src]
      r.brake[i] = r.brake[src]; r.steer[i] = r.steer[src]; r.gear[i] = r.gear[src]
    end
  end

  local payload = {
    v = 1,
    steamId = id.steamId,
    name = id.name,
    car = id.car,
    track = id.track,
    layout = id.layout,
    lapTimeMs = lapMs,
    n = N,
    t = r.t, speed = r.speed, gas = r.gas, brake = r.brake, steer = r.steer, gear = r.gear,
  }
  web.post(stored.url, { ['Content-Type'] = "application/json" }, JSON.stringify(payload), function (err, response)
    if err then
      lastSend = { ok = false, text = tostring(err), at = os.time() }
      return
    end
    local status = response and response.status or 0
    local kept = nil
    if response and response.body then
      local okParse, parsed = pcall(function() return JSON.parse(response.body) end)
      if okParse and parsed ~= nil then kept = parsed.kept end
    end
    local text = "HTTP " .. tostring(status)
    if status >= 200 and status < 300 then
      text = kept == false and "sent — your stored best stands" or "sent & saved"
    end
    lastSend = { ok = status >= 200 and status < 300, text = text, at = os.time() }
  end)
end

local function finishLap(r, lapMs)
  local clean = (lapMs or 0) > 0 and not r.dirty and not r.pit and r.filled >= N * 0.9
  local sent = false
  if clean and stored.enabled and stored.url ~= "" then
    if not stored.onlyBest or bestSentMs == nil or lapMs < bestSentMs then
      postLap(r, lapMs)
      bestSentMs = (bestSentMs == nil or lapMs < bestSentMs) and lapMs or bestSentMs
      sent = true
    end
  end
  local note = clean and (sent and "sent" or "clean, not faster") or (r.pit and "pit" or r.dirty and "off track" or "incomplete")
  lastLap = { ms = lapMs, clean = clean, sent = sent, note = note }
end

-- The engine loop. Wrapped like everything else: an error here every frame
-- would otherwise flood the log and kill the app silently.
function script.update(dt)
  local ok, err = pcall(function()
    if sim.isReplayActive then return end
    local car = ac.getCar(0)
    if car == nil then return end
    local lc = car.lapCount or 0
    if rec == nil then
      rec = newRec(lc)
    elseif lc ~= rec.lap then
      -- Exactly one lap forward = a completed lap; anything else (session
      -- restart, teleport to pits) just starts a fresh recording.
      if lc == rec.lap + 1 then finishLap(rec, math.floor(car.previousLapTimeMs or 0)) end
      rec = newRec(lc)
    end
    sampleInto(rec, car)
  end)
  if not ok then ac.debug("nabsTelemetry update error", tostring(err)) end
end

-- UI --------------------------------------------------------------------------
local function fmtMs(ms)
  if not ms or ms <= 0 then return "-" end
  local s = ms / 1000
  return string.format("%d:%06.3f", math.floor(s / 60), s % 60)
end

function script.windowMain(dt)
  ui.text(BUILD)
  local ok, err = pcall(drawMain, dt)
  if not ok then ui.textWrapped("ERROR: " .. tostring(err)) end
end

function drawMain(dt)
  if not stored.enabled then
    ui.textWrapped("Recording is OFF. Open the settings (spanner) and switch it on once; it stays on.")
    return
  end
  if stored.url == "" then
    ui.textWrapped("No league URL set. Open the settings (spanner) and paste it; recording still runs, sending doesn't.")
  end
  if rec ~= nil then
    ui.text(string.format("recording lap %d · %d%% sampled", rec.lap + 1, math.floor(rec.filled / N * 100)))
    if rec.dirty then ui.text("this lap: off track — will not be sent") end
    if rec.pit then ui.text("this lap: pit lane — will not be sent") end
  end
  if lastLap ~= nil then
    ui.separator()
    ui.text("last lap: " .. fmtMs(lastLap.ms) .. " · " .. lastLap.note)
  end
  if bestSentMs ~= nil then ui.text("best sent this session: " .. fmtMs(bestSentMs)) end
  if lastSend ~= nil then
    ui.text((lastSend.ok and "· " or "! ") .. lastSend.text)
  end
end

function script.windowSettings(dt)
  ui.text(BUILD .. " · settings")
  local ok, err = pcall(drawSettings, dt)
  if not ok then ui.textWrapped("ERROR: " .. tostring(err)) end
end

function drawSettings(dt)
  ui.text("Where laps go")
  stored.url = ui.inputText("league URL", stored.url, bit.bor(ui.InputTextFlags.Password, ui.InputTextFlags.AutoSelectAll))
  ui.textWrapped("From the league admin: Reports -> Telemetry from inside the car. The field is masked; paste it in one go.")

  if ui.checkbox("record and send my laps", stored.enabled) then
    stored.enabled = not stored.enabled
  end
  if ui.checkbox("only send when I beat my session best", stored.onlyBest) then
    stored.onlyBest = not stored.onlyBest
  end
  ui.textWrapped("Only your FASTEST clean lap per track is kept on the site either way; slower posts are dropped there. Off track or through the pits = the lap is never sent.")

  if ui.button("Test connection") then
    local url = pingUrl()
    if url == nil then
      lastSend = { ok = false, text = "no URL set", at = os.time() }
    else
      web.post(url, { ['Content-Type'] = "application/json" }, "{}", function (err, response)
        if err then
          lastSend = { ok = false, text = tostring(err), at = os.time() }
          return
        end
        local status = response and response.status or 0
        lastSend = { ok = status >= 200 and status < 300, text = "HTTP " .. tostring(status), at = os.time() }
      end)
    end
  end
  if lastSend ~= nil then
    ui.text((lastSend.ok and "· " or "! ") .. lastSend.text)
  end
end
