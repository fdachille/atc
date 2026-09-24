# Zephyr Approach — ATC Sim

A fully client-side, serverless air traffic control simulator (no backend of its own,
no build step) — just static files. You work KZXV's approach/departure radar: vector
arrivals onto the ILS, clear them to land, launch departures, climb/vector them to
their filed fix, and hand them off — all via typed, realistic ATC phraseology. The
active runway is randomized every time you load the page. One feature (LIVE TRAFFIC,
below) is opt-in and makes an outbound call to a free public API when you click it;
everything else works fully offline.

## Running it

No install needed. Because the files use `fetch`-free `<script>` tags (not ES modules),
you can either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static file server, e.g. `python3 -m http.server 8000`
  from this directory, then visit `http://localhost:8000/`.

## How it works

- Aircraft spawn periodically as **arrivals** (inbound at one of 8 compass fixes,
  45nm out) or **departures** (ready to go at KZXV, filed to exit over one of those
  fixes at a cruise altitude).
- Type commands in the console at the bottom, starting with a callsign. Chain several
  instructions with a comma or the word `then`. You don't need to click into the box
  first — just start typing anywhere on the page. Press `↑` / `↓` to recall previous
  commands.
- Click a blip on the radar or a strip in the right-hand sidebar to prefill its
  callsign in the command box.
- Scroll to zoom the radar (centered on your cursor), click-drag empty space to pan,
  double-click to reset the view.
- Use the speed buttons (1x/2x/4x/8x) or PAUSE to control how fast simulated time
  moves — handy for compressing the quiet stretches between events.
- **TRAFFIC** (top bar): EASY/NORMAL/HARD controls how many aircraft you're juggling
  at once and how often new ones check in. Starts on EASY — bump it up any time.
- **PROFILE** (top bar): toggles a side view under the radar showing distance-to-
  threshold vs. altitude with the active runway's glidepath drawn in, so it's easy to
  see who's high or low on the approach.
- **LIVE TRAFFIC** (top bar, next to HARD): imports real, currently-airborne aircraft
  from near a random major world airport, and adopts that airport's real runway
  layout, elevation, and real charted fixes — see [Live traffic](#live-traffic) below.
- **HELP** (top bar): opens the command reference as a panel on the left that stays
  up while you keep controlling traffic; close it with the × or Esc.

### Landing an arrival

Every runway at the field is drawn on the radar with its own id and heading label
(a runway labeled 09 is heading 090). Your home field starts with one, randomized
each time you load the page; importing LIVE TRAFFIC brings in that airport's real
full layout — parallels, crosswinds, letter suffixes and all. Vector the arrival
(heading commands) until it's within a couple miles of a runway's extended
centerline, descending toward its glidepath, then issue `cleared to land` (defaults
to the aircraft's current/assigned runway) or `cleared to land runway 09L` to name
one explicitly. Once established within capture range it will fly the approach and
land on its own — score points on touchdown. Clear it too early or too far off
course and it'll fly through final; you'll need to vector it back around.

### Launching a departure

Departures are assigned a runway automatically when they check in (shown on their
strip, e.g. `RWY 09L → NEAST FL180`). `N123AB cleared for takeoff` uses that runway
once it's clear, or say `N123AB cleared for takeoff runway 27R` to roll from a
different one. Once airborne, climb and steer it toward its filed fix, then `N123AB
contact center` once it's close to the fix and near its filed altitude to hand it
off for points. Leave without a proper handoff and it counts against you.

### Live traffic

Click **LIVE TRAFFIC** to pick a random airport from a curated list of 16 major hubs
(KJFK, KLAX, KORD, KATL, KDFW, KSFO, EGLL, EDDF, EHAM, RJTT, RJAA, VHHH, SBGR, SAEZ,
OTHH, OMDB) and adopt it as your active field — its real runway configuration, field
elevation, and real charted fixes (pulled from actual published approach/departure
procedures, not invented) replace your current ones — then pull whatever's really
flying near it right now into your airspace at the same relative position, altitude,
heading, and speed. Real callsigns, real traffic, real waypoints, for you to control.
If aircraft are already inbound, holding short, or routed via the old fixes when you
click it, they may need to be reassigned.

Two independent data sources feed this: the runway/fix layouts come from
[OpenScope](https://github.com/openscope/openscope)'s open-source airport data
(chart-accurate, not surveyed by us — fix positions are clamped to fit our smaller
airspace while keeping their real compass direction from the field); the live
aircraft come from the free [airplanes.live](https://airplanes.live/) ADS-B feed, a
community-run service with no uptime or coverage guarantee, so it can occasionally
come back empty or fail — the button just re-enables and you can try again. Only 16
airports are included because that's what OpenScope has charted; more could be added
if OpenScope adds them. This is the only feature in the whole app that talks to the
network; nothing is sent, only received, and no data persists anywhere.

### Separation

Keep aircraft at least 3nm apart laterally or 1000ft apart vertically. A loss of
separation costs points and flags both aircraft in red; an actual collision costs a
lot more.

**Exception:** two aircraft each established on their own parallel runway localizer
aren't penalized for flying side by side — that's how independent parallel
approaches work in real life. It only kicks in once *both* are actually captured
and tracking their own centerline; one drifting off it, or two aircraft sharing the
same runway, still count as a real conflict.

## Command reference

Every command starts with a callsign (e.g. `DAL123`). Shorthand aliases are shown
where they exist — e.g. `DAL123 des 50` = `DAL123 descend and maintain 5000`.
Shortcuts also accept the abbreviations used by [openscope.co](https://www.openscope.co/),
the well-known browser ATC sim, alongside our own — both work everywhere.

**Heading**
- `fly heading 270` — short: `h 270` / `fh 270`
- `turn left heading 180` / `turn right heading 090` — short: `tl 180` / `tr 090` / `t l 180` / `t r 090`
- `turn left 30 degrees` / `turn right 30 degrees` — short: `t l 30` / `t r 30`
- `fly present heading` — short: `ph` / `fph`

`t l`/`t r` read a 3-digit number as an absolute heading and a 1–2 digit number as a
relative turn — `t r 270` turns right *to* 270, `t r 30` turns right *by* 30°.

**Altitude**
- `climb and maintain 80` — short: `c 80` / `a 80`
- `descend and maintain 40` — short: `des 40` / `d 40`
- `maintain 50`

Altitude is entered as flight level (hundreds of feet): `80` means 8000ft. This
applies to every altitude command, long-form or shorthand. Values of 1000 or more
are still read as literal feet, so `descend and maintain 4500` also works.

**Speed**
- `reduce speed to 200` / `slow to 200` — short: `sp 200` / `s 200` / `-200`
- `increase speed to 250` / `speed up to 250` — short: `sp 250` / `+250`
- `maintain present speed` — short: `ps`
- `resume normal speed` — short: `ns`

**Navigation**
- `direct NORTH` — short: `dct NORTH` / `pd NORTH`
  (home field fixes: NORTH, NEAST, EAST, SEAST, SOUTH, SWEST, WEST, NWEST)
- `route NORTH EAST WEST` — short: `rt NORTH EAST WEST` — flies each fix in
  order, then continues on its own once the list is done
- `hold at NORTH` — short: `ho NORTH` / `hold NORTH`
- exit a hold — short: `xh` (same effect as `ph`, flies present heading)

Every airport has its own set of fixes — your home field's 8 compass points, or a
LIVE TRAFFIC airport's own real charted waypoints (named in the log when you import
one, and labeled on the radar). Selecting an aircraft draws its planned path —
current leg plus any queued route legs — as a dashed line on the radar.

Our `x` means direct-to-fix; OpenScope's `x` means a fix-crossing restriction we
don't model. Use `dct` or `pd` if that distinction ever matters to you.

**Arrivals**
- `cleared to land` — short: `ld` — uses the aircraft's current/assigned runway
- `cleared to land runway 09` — short: `ld 09` — names a specific runway (fields with more than one)
- `cleared for the approach` — short: `ap` / `i` / `ils` [runway]
- `go around` — short: `ga`
- `contact tower` — short: `ct`

**Departures**
- `cleared for takeoff` — short: `to` / `cto` / `/` — uses whichever runway they're sitting at
- `cleared for takeoff runway 27L` — short: `to 27L` — reassigns them first
- `contact center` — short: `ct`

`ct` is context-sensitive: it means "contact tower" for an arrival and "contact
center" for a departure.

**Misc**
- `squawk 4521` — short: `sq 4521`
- `ident` — short: `id`
- `say altitude` / `say heading` / `say speed` — short: `sa` / `sh` / `ss` or `si`
- `say assigned altitude` / `heading` / `speed` (what they're cleared to, not
  current) — short: `saa` / `sah` / `sas`

Click the `? HELP` button (or press Esc to close it) for this reference at any time
in-game — it docks on the left and stays up while you keep working traffic.

## Worked examples

**Landing an arrival** (`DAL123`, with RWY 09 / heading 090 in use):
```
DAL123 des 30      descend and maintain 3000
DAL123 tl 090      turn toward the runway's heading (match your actual RWY label)
DAL123 sp 180      slow down for the approach
DAL123 ld          cleared to land, once lined up and near the glidepath
```
Once cleared, watch the PROFILE panel — it should track down the dashed glidepath
on its own. If it flies through final without capturing, vector it back around and
issue `ld` again.

**Departing and handing off** (`N456CD`, filed for NEAST at FL180):
```
N456CD to          cleared for takeoff
N456CD c 180       climb and maintain 18000 once airborne
N456CD dct NEAST   direct to its filed fix
N456CD ct          contact center once close to NEAST and near FL180
```

## File layout

```
index.html      page shell, DOM wiring
style.css       radar-scope styling
js/data.js      airport, fixes, airlines, aircraft type performance data
js/aircraft.js  Aircraft class: turn/climb/speed physics, approach & takeoff autopilot
js/parser.js    command grammar → structured actions
js/radar.js     canvas rendering of the scope (plan view, pan/zoom, compass)
js/profile.js   canvas rendering of the approach profile (side view) panel
js/livetraffic.js  world airport list + airplanes.live fetch/convert for LIVE TRAFFIC
js/game.js      spawning, scoring, conflict detection, command execution, main loop
```

All physics (turn rates, climb/descent rates, acceleration, approach geometry) are
simplified approximations tuned for gameplay, not exact real-world performance figures.
