--------------------------------------------------------------------------------
-- webPenalty NABS — a league fork.
--
-- ORIGINAL: webPenalty v0.5 by TeTeMaTeTe (https://ko-fi.com/offsentreracing).
-- All the credit for the reporting mechanism and the replay clock is theirs.
-- FORKED:   2026-08-12 for the NABS Racing League.
--
-- WHAT THE LEAGUE CHANGED, and nothing else:
--   1. Reports can post to the league website as well as to a Discord webhook.
--      The wire format is untouched — the site reads Discord's own shape — so
--      the URL field simply accepts either.
--   2. A "Jump to" panel for stewards: paste the position a report gives you
--      ("12:34") and the replay seeks there, using ac.setReplayPosition.
--   3. The seek is driven by SESSION TIME, never by the wall clock. No
--      timezone, no date, no os.time(), so it cannot be an hour out.
--   4. The magic "+2738" in the original's replay clock became a calibration
--      field in the settings, with the procedure written next to it.
--   5. Crash guards: the web callback no longer indexes a nil response, the
--      replay blob no longer feeds nil into arithmetic, and a server-sent
--      message no longer calls a method on a nil sender.
--   6. The report result is shown IN GAME ("sent" / "failed 401"), so a
--      mistyped URL stops looking like a broken feature.
--
-- DELIBERATELY NOT CHANGED: the ac.OnlineEvent struct and its key. Whatever
-- script fires the report for the drivers declares the same struct, and
-- changing it on one side only would stop reporting entirely.
--------------------------------------------------------------------------------

local stored = ac.storage{
  -- Either a Discord webhook or the league's own ingest URL. The site's admin
  -- area (Reports -> Reports from inside the race) prints the exact string.
  key = "",
  enabled = false,
  tags = "",
  -- Seconds to add to the replay clock so it reads the real time of day. The
  -- original hard-coded 2738 here; see windowSettings for how to measure it.
  clockOffset = 0,
  -- Seconds to add to a pasted target before seeking. The website measures
  -- "into the race" from the first thing in the result file, which is not
  -- exactly where the replay's own timeline starts. One calibration, one
  -- number, and every later jump is right.
  seekOffset = 0,
}

local sim = ac.getSim()
local timestamp = 0
local sessionStartTime = 0
local settings = false

-- Last report result, for the in-game status line.
local lastSend = nil        -- { ok = bool, text = string, at = number }

-- Settings-panel text buffers. The stored values are numbers; these hold what
-- is being typed, so a half-typed "-" doesn't become 0 mid-keystroke.
seekOffsetText = nil
clockOffsetText = nil

-- Seek state. The jump runs over several frames on purpose: one calculation
-- from replayFrameMs is a good guess, not an exact answer, so we land, measure
-- again and close the gap. Converges in two or three passes.
local seek = { target = nil, tries = 0, note = nil }
local SEEK_MAX_TRIES = 6
local SEEK_GOOD_ENOUGH = 0.15 -- seconds

-- Guarded, and this is the whole lesson of this app: ANY top-level statement
-- that throws stops the chunk before `script.windowMain` is ever defined, and
-- CSP then shows an empty grey window with nothing in the log to explain it.
-- Nothing up here is allowed to be able to do that.
local blobError = nil
do
  local ok, err = pcall(function()
    if not sim.isReplayActive then
      ac.writeReplayBlob("TimestampSessionStart", tostring(os.time() - sim.currentSessionTime / 1000))
    else
      -- Blobs come back as strings, and a replay recorded before this app
      -- existed has none at all. The original did arithmetic on whatever came
      -- back, every frame, which is nil on any older replay.
      sessionStartTime = tonumber(ac.readReplayBlob("TimestampSessionStart")) or 0
    end
  end)
  if not ok then blobError = tostring(err) end
end

--------------------------------------------------------------------------------
-- Helpers
--------------------------------------------------------------------------------

-- "12:34", "1:02:34" or plain "754" -> seconds. nil when it is not a time.
local function parseTarget(s)
  s = tostring(s or ""):gsub("%s", "")
  if s == "" then return nil end
  local parts = {}
  for piece in s:gmatch("[^:]+") do parts[#parts + 1] = piece end
  for i = 1, #parts do
    local n = tonumber(parts[i])
    if not n then return nil end
    parts[i] = n
  end
  if #parts == 1 then return parts[1] end
  if #parts == 2 then return parts[1] * 60 + parts[2] end
  if #parts == 3 then return parts[1] * 3600 + parts[2] * 60 + parts[3] end
  return nil
end

local function mmss(sec)
  if sec == nil then return "--:--" end
  local neg = sec < 0
  sec = math.floor(math.abs(sec) + 0.5)
  local out = string.format("%d:%02d", math.floor(sec / 60), sec % 60)
  return neg and ("-" .. out) or out
end

-- Where playback currently is, in seconds from the session's start. This is the
-- one number the seek works in: AC's own, with no clock of anybody's involved.
local function currentSecond()
  return (sim.currentSessionTime or 0) / 1000
end

-- Can this CSP seek at all? Checked rather than assumed, so an older install
-- degrades to "read the numbers and drag the slider" instead of erroring.
local function canSeek()
  return type(ac.setReplayPosition) == "function"
end

--------------------------------------------------------------------------------
-- Reporting (unchanged on the wire)
--------------------------------------------------------------------------------

-- Only the HANDLER here. Registering the event is an engine call that can fail
-- (offline, or before the shared namespace exists), and it happens at the very
-- END of this file on purpose — see the note down there.
local function onReport(sender, message)
  if not stored.enabled then return end
  if stored.key == "" then
    lastSend = { ok = false, text = "no URL set", at = os.time() }
    return
  end

  -- CSP passes nil for a server-originated message; the original called a
  -- method on it unconditionally.
  local who = "Unknown driver"
  if sender ~= nil and sender.driverName ~= nil then
    local ok, name = pcall(function() return sender:driverName() end)
    if ok and name ~= nil and name ~= "" then who = name end
  end

  local dataToSend = {
    content = "This report was generated during the race. If the person reporting has any additional comments or wishes to remove the report, they can put a message in the chat below.",
    -- Same shape as before: "<driver> | <HH:MM:SS>". The league site splits on
    -- the LAST pipe, so a clan tag in the name survives.
    --
    -- os.dateGlobal, not os.date, because that is what the original used and
    -- what is known to exist in this sandbox. Which timezone it renders has
    -- never been established — which is exactly why the league site no longer
    -- builds its timestamp from this string. It stamps the report when the
    -- post arrives and keeps this only as a note in the body.
    thread_name = who .. " | " .. os.dateGlobal("%H:%M:%S", os.time()),
  }
  if stored.tags ~= "" then
    dataToSend["applied_tags"] = { stored.tags }
  end

  web.post(stored.key, { ['Content-Type'] = "application/json" }, JSON.stringify(dataToSend), function (err, response)
    -- The original indexed response.body with no guard: any timeout or DNS
    -- failure threw here, in a callback, where nobody sees it.
    if err then
      lastSend = { ok = false, text = tostring(err), at = os.time() }
      ac.debug("webPenaltyNABS error", tostring(err))
      return
    end
    local status = response and response.status or 0
    lastSend = { ok = status >= 200 and status < 300, text = "HTTP " .. tostring(status), at = os.time() }
    ac.debug("webPenaltyNABS response", response and response.body or "")
  end)
end

--------------------------------------------------------------------------------
-- Settings
--------------------------------------------------------------------------------

-- Both window functions are split in two: a thin outer one CSP calls, and the
-- real body behind a pcall. An error inside a window function otherwise leaves
-- an empty grey panel and says nothing anywhere — not in the CSP log, not on
-- screen — which is exactly how the first build of this fork failed. Now the
-- error is printed where the content should have been.
--
-- The build marker on the first line is the other half of that: if even IT is
-- missing, the problem is not in the drawing code, it is that CSP never called
-- the function at all.
local BUILD = "nabs build 3"

function script.windowSettings(dt)
  ui.text(BUILD .. " · settings")
  local ok, err = pcall(drawSettings, dt)
  if not ok then ui.textWrapped("ERROR: " .. tostring(err)) end
end

function drawSettings(dt)
  settings = true

  ui.text("Where reports go")
  stored.key = ui.inputText("report URL", stored.key, bit.bor(ui.InputTextFlags.Password, ui.InputTextFlags.AutoSelectAll))
  ui.textWrapped("Either a Discord webhook or the league URL from the admin area (Reports -> Reports from inside the race). One or the other, not both.")
  stored.tags = ui.inputText("Optional tag ID (Discord only)", stored.tags, ui.InputTextFlags.AutoSelectAll)

  if ui.checkbox("relay reports from this PC", stored.enabled) then
    stored.enabled = not stored.enabled
  end
  ui.textWrapped("With the league URL, two or three people may have this on: the site collapses the same driver's press into one report. With a Discord webhook, keep it to one person or you get duplicates.")

  if ui.button("Test Report") then
    -- `report` is nil when the online event could not be registered (see the
    -- foot of this file). Saying so beats a silent nothing.
    if report then
      report({ balls = true })
    else
      lastSend = { ok = false, text = "reporting unavailable here (offline?)", at = os.time() }
    end
  end

  ui.separator()
  ui.text("Steward calibration")
  -- Text fields rather than sliders: ui.inputText is API the original app
  -- already proves exists in this sandbox, and none of this can be tried
  -- outside the game. A number typed once a season does not need a slider.
  seekOffsetText = ui.inputText("jump offset (seconds)", seekOffsetText or tostring(stored.seekOffset), ui.InputTextFlags.AutoSelectAll)
  stored.seekOffset = tonumber(seekOffsetText) or 0
  ui.textWrapped("Only if jumps land consistently early or late. Open a replay, jump to a report's position, see how far off the incident is, and type that difference here. Once per league, not per race.")

  clockOffsetText = ui.inputText("clock offset (seconds)", clockOffsetText or tostring(stored.clockOffset), ui.InputTextFlags.AutoSelectAll)
  stored.clockOffset = tonumber(clockOffsetText) or 0
  ui.textWrapped("Only affects the time-of-day readout, never the jump. The original app had 2738 baked in here.")
end

--------------------------------------------------------------------------------
-- Main window
--------------------------------------------------------------------------------

function script.windowMain(dt)
  ui.text(BUILD)
  if blobError then ui.textWrapped("replay blob: " .. blobError) end
  local ok, err = pcall(drawMain, dt)
  if not ok then ui.textWrapped("ERROR: " .. tostring(err)) end
end

function drawMain(dt)
  if stored.key == "" and not settings then
    ui.textWrapped("Set a report URL in the settings panel (the spanner, top right of this window).")
  end

  -- The wall clock, as in the original: instant replay, replay-only playback,
  -- or a plain clock while racing.
  if sim.isReplayActive and not sim.isReplayOnlyMode then
    timestamp = os.time() - ((sim.replayFrames - sim.replayCurrentFrame) * sim.replayFrameMs) / 1000
  elseif sim.isReplayOnlyMode then
    timestamp = sessionStartTime + currentSecond() + stored.clockOffset
  else
    timestamp = os.time()
  end

  ui.pushFont(ui.Font.Title)
  ui.beginScale()
  ui.text(os.dateGlobal("%d %H:%M:%S", timestamp))
  ui.endScale(2)
  -- The original never popped. Guarded rather than assumed: if this build has
  -- no popFont, an unbalanced push is a cosmetic problem, calling something
  -- that does not exist is a dead app.
  if ui.popFont then ui.popFont() end

  -- Whether the last report actually went anywhere. Two minutes is long enough
  -- to notice and short enough not to become furniture.
  if lastSend and os.time() - lastSend.at < 120 then
    ui.text(lastSend.ok and ("report sent (" .. lastSend.text .. ")") or ("report FAILED: " .. lastSend.text))
  end

  -- Reporting could not register (offline session, say). The steward half below
  -- is unaffected, so this is a note rather than a failure.
  if reportUnavailable then
    ui.text("reporting off (needs a server session)")
  end

  if not sim.isReplayActive then return end

  --------------------------------------------------------------------
  -- Steward half: only while a replay is open, because that is the only
  -- time any of it means anything.
  --------------------------------------------------------------------
  ui.separator()
  ui.text("Jump to a report")

  seek.input = ui.inputText("position (12:34)", seek.input or "", ui.InputTextFlags.AutoSelectAll)

  local target = parseTarget(seek.input)
  local now = currentSecond()

  ui.text("now:    " .. mmss(now))
  if target then
    local wanted = target + stored.seekOffset
    ui.text("target: " .. mmss(wanted))
    -- The delta is the honest half of this panel. Even if seeking is
    -- unavailable, a steward can drag the slider and watch this go to zero.
    ui.text("delta:  " .. mmss(wanted - now))
  else
    ui.text("target: --:--")
    ui.text("delta:  --:--")
  end

  if not canSeek() then
    ui.textWrapped("This CSP build cannot move the replay from a script. Drag the replay slider until 'delta' reads 0:00.")
  elseif target == nil then
    ui.textWrapped("Paste the position from the report, e.g. 12:34.")
  else
    if ui.button("Jump") then
      seek.target = target + stored.seekOffset
      seek.tries = 0
      seek.note = nil
    end
    if seek.note then ui.text(seek.note) end
  end

  -- Run the jump over successive frames: seek, let AC move, measure, correct.
  if seek.target ~= nil then
    local delta = seek.target - now
    if math.abs(delta) <= SEEK_GOOD_ENOUGH then
      seek.note = "arrived (" .. mmss(now) .. ")"
      seek.target = nil
    elseif seek.tries >= SEEK_MAX_TRIES then
      seek.note = "closest it could get: " .. mmss(now)
      seek.target = nil
    else
      local frameMs = sim.replayFrameMs
      if frameMs == nil or frameMs <= 0 then
        seek.note = "replay frame length unknown"
        seek.target = nil
      else
        local frame = sim.replayCurrentFrame + delta * 1000 / frameMs
        frame = math.floor(math.max(0, math.min((sim.replayFrames or 1) - 1, frame)))
        ac.setReplayPosition(frame, 0)
        seek.tries = seek.tries + 1
        seek.note = "seeking… (" .. tostring(seek.tries) .. ")"
      end
    end
  end
end

--------------------------------------------------------------------------------
-- Registering the online event. LAST in the file, and wrapped, for one reason
-- learned the hard way: this is an engine call that can fail — offline, or
-- before the shared namespace exists — and a bare failure here aborts the whole
-- chunk. Registered ABOVE the window functions, as it was in the first version
-- of this fork, that meant `script.windowMain` and `script.windowSettings` were
-- never defined at all: the app opened to an empty grey window, in both panels,
-- with no error anywhere in the CSP log, because the chunk had compiled fine.
--
-- The original app has it last too. Now it is last AND guarded, so the steward
-- half of this app keeps working in a replay even where reporting cannot.
--------------------------------------------------------------------------------
local registered, result = pcall(function()
  return ac.OnlineEvent(
    { ac.StructItem.key("AwesomeReportKey"), balls = ac.StructItem.boolean() },
    onReport,
    ac.SharedNamespace.ServerScript
  )
end)

if registered then
  report = result
else
  report = nil
  reportUnavailable = tostring(result)
  ac.debug("webPenaltyNABS: reporting unavailable", reportUnavailable)
end
