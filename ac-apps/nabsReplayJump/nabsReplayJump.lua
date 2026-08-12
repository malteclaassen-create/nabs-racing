-- NABS Replay Jump
-- Paste the time from a report, hit Jump, watch the incident.

local sim = ac.getSim()
local stored = ac.storage{ offset = 0 }

local input = ''
local offsetText = nil
local note = nil

local target = nil
local tries = 0
local MAX_TRIES = 6
local TOLERANCE = 0.15

-- accepts 12:34, 1:02:34 or plain seconds
local function parseTime(s)
  s = tostring(s or ''):gsub('%s', '')
  if s == '' then return nil end

  local parts = {}
  for piece in s:gmatch('[^:]+') do
    local n = tonumber(piece)
    if not n then return nil end
    parts[#parts + 1] = n
  end

  if #parts == 1 then return parts[1] end
  if #parts == 2 then return parts[1] * 60 + parts[2] end
  if #parts == 3 then return parts[1] * 3600 + parts[2] * 60 + parts[3] end
  return nil
end

local function clock(sec)
  if sec == nil then return '--:--' end
  local sign = sec < 0 and '-' or ''
  sec = math.floor(math.abs(sec) + 0.5)
  return sign .. string.format('%d:%02d', math.floor(sec / 60), sec % 60)
end

local function elapsed()
  return (sim.currentSessionTime or 0) / 1000
end

-- one seek is a guess, replayFrameMs is an average. so: jump, look, jump again.
local function step(now)
  local delta = target - now

  if math.abs(delta) <= TOLERANCE then
    note = 'arrived (' .. clock(now) .. ')'
    target = nil
    return
  end

  if tries >= MAX_TRIES then
    note = 'closest it could get: ' .. clock(now)
    target = nil
    return
  end

  local frameMs = sim.replayFrameMs
  if not frameMs or frameMs <= 0 then
    note = 'no frame length, cannot seek'
    target = nil
    return
  end

  local frame = sim.replayCurrentFrame + delta * 1000 / frameMs
  frame = math.floor(math.max(0, math.min((sim.replayFrames or 1) - 1, frame)))
  ac.setReplayPosition(frame, 0)

  tries = tries + 1
  note = 'seeking ' .. tries
end

function script.windowMain(dt)
  if not sim.isReplayActive then
    ui.textWrapped('Open a race replay first.')
    return
  end

  input = ui.inputText('position (12:34)', input, ui.InputTextFlags.AutoSelectAll)

  local wanted = parseTime(input)
  if wanted then wanted = wanted + stored.offset end
  local now = elapsed()

  ui.text('now:    ' .. clock(now))
  ui.text('target: ' .. clock(wanted))
  ui.text('delta:  ' .. (wanted and clock(wanted - now) or '--:--'))

  if type(ac.setReplayPosition) ~= 'function' then
    ui.textWrapped('This CSP build has no replay seeking. Drag the slider until delta reads 0:00.')
  elseif wanted and ui.button('Jump') then
    target = wanted
    tries = 0
    note = nil
  end

  if note then ui.text(note) end
  if target then step(now) end
end

function script.windowSettings(dt)
  offsetText = ui.inputText('jump offset (seconds)', offsetText or tostring(stored.offset), ui.InputTextFlags.AutoSelectAll)
  stored.offset = tonumber(offsetText) or 0
  ui.textWrapped('Leave at 0 unless every jump lands early or late by the same amount. Then put that difference here, once.')
end
