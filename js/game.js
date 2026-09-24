// Game orchestration: spawning, scoring, conflict detection, command execution, UI wiring.

function friendlyName(callsign) {
  var m = callsign.match(/^([A-Z]{3})(\d+)$/);
  if (!m) return callsign;
  for (var i = 0; i < AIRLINES.length; i++) {
    if (AIRLINES[i].code === m[1]) return AIRLINES[i].name + ' ' + m[2];
  }
  return callsign;
}

function pad3n(n) {
  var s = '' + Math.round(n);
  while (s.length < 3) s = '0' + s;
  return s;
}

// headings are always spoken/written 001-360; due north is "360", never "000"
function hdgText(h) {
  var n = Math.round(h) % 360;
  if (n <= 0) n += 360;
  return pad3n(n);
}

function fmtClock(totalSec) {
  var h = Math.floor(totalSec / 3600) % 24;
  var m = Math.floor((totalSec % 3600) / 60);
  var s = Math.floor(totalSec % 60);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(h) + ':' + p(m) + ':' + p(s) + 'z';
}

var DIFFICULTIES = {
  easy: { label: 'EASY', spawnMin: 90, spawnMax: 150, maxAircraft: 4, initialDelay: 35 },
  normal: { label: 'NORMAL', spawnMin: 35, spawnMax: 75, maxAircraft: 8, initialDelay: 15 },
  hard: { label: 'HARD', spawnMin: 18, spawnMax: 40, maxAircraft: 14, initialDelay: 6 }
};

function weightedType() {
  var r = Math.random();
  if (r < 0.08) return AIRCRAFT_TYPES.filter(function (t) { return t.code === 'C172'; })[0];
  if (r < 0.20) return pick(AIRCRAFT_TYPES.filter(function (t) { return t.category === 'heavy'; }));
  if (r < 0.55) return pick(AIRCRAFT_TYPES.filter(function (t) { return t.category === 'jet'; }));
  return pick(AIRCRAFT_TYPES.filter(function (t) { return t.category === 'regional'; }));
}

function Game(canvas, dom) {
  this.dom = dom;
  this.radar = new Radar(canvas);
  this.profile = dom.profileCanvas ? new ProfileView(dom.profileCanvas) : null;
  this.aircraft = [];
  this.score = 0;
  this.stats = { landings: 0, departures: 0, incidents: 0, missed: 0 };
  this.simTime = 0;
  this.timeMultiplier = 1;
  this.paused = false;
  this.difficulty = 'easy';
  this.spawnTimer = DIFFICULTIES[this.difficulty].initialDelay;
  this.activeConflicts = {};
  this.selectedCallsign = null;
  this.maxAircraft = DIFFICULTIES[this.difficulty].maxAircraft;
  this._lastFrame = null;
  this._stripTimer = 0;
  this.history = [];
  this._historyIndex = null;
  this._historyDraft = '';
  this._bind();
  if (this.dom.profileTitle) this.dom.profileTitle.textContent = 'APPROACH PROFILE';
  this.log('Radar contact established. ' + AIRPORT.icao + ' ' + AIRPORT.name + ', runway ' + this._runwayListText() + ' in use.', 'info');
  this.refreshStats();
}

Game.prototype._runwayListText = function () {
  return AIRPORT.runways.map(function (r) { return r.id; }).join('/');
};

Game.prototype._bind = function () {
  var self = this;
  this.dom.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var val = self.dom.input.value;
    self.dom.input.value = '';
    self._historyIndex = null;
    self._historyDraft = '';
    if (val.trim() && val.trim() !== self.history[self.history.length - 1]) {
      self.history.push(val.trim());
    }
    self.handleInput(val);
  });

  this.dom.input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp') { e.preventDefault(); self._historyUp(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); self._historyDown(); }
  });

  this.dom.speedButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var v = btn.getAttribute('data-speed');
      if (v === 'pause') {
        self.paused = !self.paused;
        btn.textContent = self.paused ? 'RESUME' : 'PAUSE';
      } else {
        self.timeMultiplier = +v;
        self.paused = false;
        self.dom.speedButtons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var pauseBtn = self.dom.speedButtons.filter(function (b) { return b.getAttribute('data-speed') === 'pause'; })[0];
        if (pauseBtn) pauseBtn.textContent = 'PAUSE';
      }
    });
  });

  if (this.dom.diffButtons) {
    this.dom.diffButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var level = btn.getAttribute('data-diff');
        self.setDifficulty(level);
        self.dom.diffButtons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }

  this.dom.helpBtn.addEventListener('click', function () {
    self.dom.helpPanel.classList.toggle('hidden');
    self._syncCanvasSizes();
  });
  this.dom.helpClose.addEventListener('click', function () {
    self.dom.helpPanel.classList.add('hidden');
    self._syncCanvasSizes();
  });

  if (this.dom.profileBtn && this.profile) {
    this.dom.profileBtn.addEventListener('click', function () {
      self.dom.profileWrap.classList.toggle('hidden');
      self._syncCanvasSizes();
    });
    this.dom.profileClose.addEventListener('click', function () {
      self.dom.profileWrap.classList.add('hidden');
      self._syncCanvasSizes();
    });
  }

  if (this.dom.liveBtn) {
    this.dom.liveBtn.addEventListener('click', function () { self.importLiveTraffic(); });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    self.dom.helpPanel.classList.add('hidden');
    if (self.dom.profileWrap) self.dom.profileWrap.classList.add('hidden');
  });

  this.radar.canvas.addEventListener('click', function (e) {
    if (self.radar.wasDragged && self.radar.wasDragged()) return;
    var rect = self.radar.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var best = null, bestD = 16;
    for (var i = 0; i < self.aircraft.length; i++) {
      var ac = self.aircraft[i];
      var p = self.radar.toScreen(ac.x, ac.y);
      var d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestD) { bestD = d; best = ac; }
    }
    if (best) {
      self.selectedCallsign = best.callsign;
      self.dom.input.value = best.callsign + ' ';
      self.dom.input.focus();
      self.refreshStrips();
    }
  });

  // typing anywhere on the page drops you straight into the command box
  document.addEventListener('keydown', function (e) {
    if (document.activeElement === self.dom.input) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'ArrowUp') { e.preventDefault(); self.dom.input.focus(); self._historyUp(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); self.dom.input.focus(); self._historyDown(); return; }

    if (e.key.length !== 1) return; // printable characters only; leave Tab/Escape/etc alone
    self.dom.input.focus();
  });
};

Game.prototype._historyUp = function () {
  if (this.history.length === 0) return;
  if (this._historyIndex === null) {
    this._historyDraft = this.dom.input.value;
    this._historyIndex = this.history.length;
  }
  this._historyIndex = Math.max(0, this._historyIndex - 1);
  this.dom.input.value = this.history[this._historyIndex];
  var len = this.dom.input.value.length;
  this.dom.input.setSelectionRange(len, len);
};

Game.prototype._historyDown = function () {
  if (this._historyIndex === null) return;
  this._historyIndex++;
  if (this._historyIndex >= this.history.length) {
    this._historyIndex = null;
    this.dom.input.value = this._historyDraft;
  } else {
    this.dom.input.value = this.history[this._historyIndex];
  }
  var len = this.dom.input.value.length;
  this.dom.input.setSelectionRange(len, len);
};

Game.prototype._syncCanvasSizes = function () {
  this.radar._resize();
  if (this.profile && !this.dom.profileWrap.classList.contains('hidden')) this.profile._resize();
};

Game.prototype.setDifficulty = function (level) {
  if (!DIFFICULTIES[level]) return;
  this.difficulty = level;
  this.maxAircraft = DIFFICULTIES[level].maxAircraft;
  this.log('Difficulty set to ' + DIFFICULTIES[level].label + '.', 'info');
};

Game.prototype.log = function (text, kind) {
  var row = document.createElement('div');
  row.className = 'logrow ' + (kind || 'info');
  var t = document.createElement('span');
  t.className = 'logtime';
  t.textContent = fmtClock(this.simTime);
  row.appendChild(t);
  var msg = document.createElement('span');
  msg.textContent = ' ' + text;
  row.appendChild(msg);
  this.dom.log.appendChild(row);
  this.dom.log.scrollTop = this.dom.log.scrollHeight;
  while (this.dom.log.children.length > 200) this.dom.log.removeChild(this.dom.log.firstChild);
};

Game.prototype.addScore = function (n, text) {
  this.score += n;
  this.log('+' + n + ' ' + text, 'good');
  this.refreshStats();
};

Game.prototype.penalize = function (n, text) {
  this.score -= n;
  this.stats.incidents++;
  this.log('-' + n + ' ' + text, 'bad');
  this.refreshStats();
};

Game.prototype.onLanded = function (ac) {
  var runway = ac.assignedRunway || AIRPORT.runways[0];
  runway.occupiedUntil = this.simTime + 25;
  this.stats.landings++;
  this.addScore(15, ac.callsign + ' landed safely, runway ' + runway.id);
};

// finds a runway at the current airport by id (e.g. "04L"); returns null if none match
Game.prototype._resolveRunway = function (rwyId) {
  if (!rwyId) return null;
  var upper = rwyId.toUpperCase();
  return AIRPORT.runways.filter(function (r) { return r.id === upper; })[0] || null;
};

Game.prototype.findAircraft = function (callsign) {
  for (var i = 0; i < this.aircraft.length; i++) {
    if (this.aircraft[i].callsign === callsign) return this.aircraft[i];
  }
  return null;
};

// ---- spawning ----
Game.prototype.spawnArrival = function () {
  var fix = pick(FIXES);
  var type = weightedType();
  var alt = randInt(8000, Math.min(18000, type.cruiseAlt[1]));
  var speed = Math.round(type.cruiseSpeed * randRange(0.85, 1));
  var brg = (fix.bearing + 180) % 360;
  var offset = randRange(-15, 15);
  var ac = new Aircraft({
    callsign: generateCallsign(type.code === 'C172'),
    typeInfo: type,
    role: 'arrival',
    x: fix.x, y: fix.y,
    altitude: alt,
    heading: normalizeHeading(brg + offset),
    speed: speed,
    mode: 'enroute',
    spawnTime: this.simTime
  });
  this.aircraft.push(ac);
  this.log(friendlyName(ac.callsign) + ' checking on, level ' + pad3n(alt / 100) + ', ' + fix.name + ' arrival.', 'checkin');
};

Game.prototype.spawnDeparture = function () {
  var type = weightedType();
  var fix = pick(FIXES);
  var filedAlt = Math.min(type.cruiseAlt[1], randInt(12000, 24000));
  var runway = pick(AIRPORT.runways);
  var rad = runway.heading * Math.PI / 180;
  var ac = new Aircraft({
    callsign: generateCallsign(type.code === 'C172'),
    typeInfo: type,
    role: 'departure',
    x: runway.threshold.x + Math.sin(rad) * 0.05, y: runway.threshold.y + Math.cos(rad) * 0.05,
    altitude: AIRPORT.elevation,
    heading: runway.heading,
    speed: 0,
    mode: 'onground',
    assignedFix: fix.name,
    filedAltitude: filedAlt,
    assignedRunway: runway,
    spawnTime: this.simTime
  });
  ac.targetAltitude = AIRPORT.elevation;
  ac.targetSpeed = 0;
  this.aircraft.push(ac);
  this.log(friendlyName(ac.callsign) + ' ready for departure, runway ' + runway.id + ', request ' + fix.name + ' departure.', 'checkin');
};

// ---- live traffic import ----
Game.prototype._adoptAirport = function (airport) {
  var prevIds = AIRPORT.runways.map(function (r) { return r.id; }).join('/');
  var changed = prevIds !== airport.runways.map(function (r) { return r.id; }).join('/') || AIRPORT.icao !== airport.icao;

  AIRPORT.icao = airport.icao;
  AIRPORT.name = airport.name;
  AIRPORT.elevation = airport.elevation;
  AIRPORT.runways = airport.runways.map(function (r) {
    return { id: r.id, heading: r.heading, threshold: { x: r.threshold.x, y: r.threshold.y }, occupiedUntil: 0 };
  });
  FIXES = airport.fixes.map(function (f) {
    return { name: f.name, bearing: f.bearing, distance: f.distance, x: f.x, y: f.y };
  });

  if (this.dom.brandIcao) this.dom.brandIcao.textContent = airport.icao;
  if (this.dom.brandSub) this.dom.brandSub.textContent = airport.name.toUpperCase() + ' APP/DEP';
  if (this.dom.profileTitle) this.dom.profileTitle.textContent = 'APPROACH PROFILE';

  this.log('Now operating out of ' + airport.icao + ' ' + airport.name + ', ' + airport.country +
    ' — runways ' + this._runwayListText() + ', field elevation ' + airport.elevation + 'ft.', 'info');
  this.log('Fixes: ' + FIXES.map(function (f) { return f.name; }).join(', ') + '.', 'info');
  if (changed) {
    this.log('Traffic already on approach, holding short, waiting to depart, or routed via the old fixes may need to be reassigned.', 'warn');
  }
};


Game.prototype.importLiveTraffic = function () {
  var self = this;
  if (this._liveFetchInFlight) return;

  // deliberate bulk import — capped independently of the TRAFFIC difficulty's
  // organic-spawn ceiling, so EASY doesn't throttle a realistic-sized batch
  var capacity = LIVE_TRAFFIC_TOTAL_CAP - this.aircraft.length;
  if (capacity <= 0) {
    this.log('Ramp is full — clear some traffic before importing more.', 'warn');
    return;
  }

  this._liveFetchInFlight = true;
  if (this.dom.liveBtn) { this.dom.liveBtn.disabled = true; this.dom.liveBtn.textContent = 'REACHING OUT…'; }
  this.log('Reaching out for live traffic near a random airport (via airplanes.live)…', 'info');

  fetchLiveTraffic().then(function (result) {
    var airport = result.airport;
    self._adoptAirport(airport);
    var candidates = result.records
      .filter(function (r) {
        return typeof r.lat === 'number' && typeof r.lon === 'number' &&
          typeof r.alt_baro === 'number' && r.alt_baro > 500;
      })
      .map(function (r) {
        var pos = latLonToNm(r.lat, r.lon, airport.lat, airport.lon);
        return { r: r, pos: pos, dist: Math.hypot(pos.x, pos.y) };
      })
      .filter(function (e) { return e.dist <= AIRSPACE_RADIUS - 3; })
      .sort(function (a, b) { return a.dist - b.dist; })
      .slice(0, Math.min(capacity, LIVE_TRAFFIC_MAX_IMPORT));

    if (candidates.length === 0) {
      self.log('No airborne traffic found near ' + airport.name + ' right now — try again for a different airport.', 'warn');
      return;
    }

    candidates.forEach(function (e) {
      var r = e.r;
      var callsign = ('' + (r.flight || r.hex || 'LIVE')).trim().toUpperCase().replace(/\s+/g, '') || ('LIVE' + randInt(100, 999));
      while (usedCallsigns[callsign]) callsign += randInt(1, 9);
      usedCallsigns[callsign] = true;

      var typeInfo = mapLiveAircraftType(r.t);
      var heading = typeof r.track === 'number' ? r.track : (typeof r.true_heading === 'number' ? r.true_heading : randInt(0, 359));
      var speed = typeof r.gs === 'number' && r.gs > 40 ? r.gs : randRange(200, 260);

      var ac = new Aircraft({
        callsign: callsign, typeInfo: typeInfo, role: 'arrival',
        x: e.pos.x, y: e.pos.y, altitude: r.alt_baro, heading: normalizeHeading(heading), speed: speed,
        mode: 'enroute', spawnTime: self.simTime
      });
      self.aircraft.push(ac);
      self.log(callsign + ' checking on — live traffic near ' + airport.name + ', level ' + pad3n(r.alt_baro / 100) + '.', 'checkin');
    });

    self.log('Imported ' + candidates.length + ' live aircraft near ' + airport.name + ', ' + airport.country + ' (data: airplanes.live).', 'good');
  }).catch(function (err) {
    self.log('Could not reach the live traffic feed (' + (err && err.message ? err.message : 'network error') + '). Try again in a moment.', 'bad');
  }).then(function () {
    self._liveFetchInFlight = false;
    if (self.dom.liveBtn) { self.dom.liveBtn.disabled = false; self.dom.liveBtn.textContent = '🌐 LIVE TRAFFIC'; }
  });
};

// ---- command execution ----
Game.prototype.handleInput = function (raw) {
  if (!raw || !raw.trim()) return;
  if (raw.trim().toLowerCase() === 'help' || raw.trim() === '?') {
    this.dom.helpPanel.classList.toggle('hidden');
    return;
  }
  this.log('> ' + raw, 'sent');
  var parsed = parseCommand(raw);
  if (!parsed.ok) {
    this.log(parsed.error, 'bad');
    return;
  }
  var ac = this.findAircraft(parsed.callsign);
  if (!ac) {
    this.log('No aircraft with callsign ' + parsed.callsign + '.', 'bad');
    return;
  }
  var phrases = [];
  var anyOk = false;
  for (var i = 0; i < parsed.actions.length; i++) {
    var res = this.applyAction(ac, parsed.actions[i]);
    phrases.push(res.msg);
    if (res.ok) anyOk = true;
  }
  var line = phrases.join(', ') + ', ' + friendlyName(ac.callsign) + '.';
  this.log(line, anyOk ? 'recv' : 'bad');
};

Game.prototype._cancelApproach = function (ac) {
  ac.clearedToLand = false;
  ac.clearedApproach = false;
  ac.captured = false;
  ac.mode = 'enroute';
};

Game.prototype._handleContactCenter = function (ac) {
  if (ac.role !== 'departure') return { ok: false, msg: 'Unable' };
  var fix = findFix(ac.assignedFix);
  var d = distanceBetween(ac.x, ac.y, fix.x, fix.y);
  if (d > 6) return { ok: false, msg: 'Unable, not yet at ' + ac.assignedFix };
  if (ac.altitude < ac.filedAltitude - 1500) return { ok: false, msg: 'Unable, need more altitude' };
  ac.mode = 'exited';
  ac.removable = true;
  ac.removeReason = 'handed-off';
  this.addScore(10, ac.callsign + ' handed off at ' + ac.assignedFix);
  return { ok: true, msg: 'Contact center, good day' };
};

Game.prototype.applyAction = function (ac, a) {
  var self = this;
  var t = ac.typeInfo;

  if (a.type === 'heading' || a.type === 'heading_rel' || a.type === 'altitude') {
    if (ac.mode === 'approach') this._cancelApproach(ac);
  }

  switch (a.type) {
    case 'heading':
      ac.setHeading(a.value, a.dir);
      return { ok: true, msg: (a.dir ? (a.dir === 'left' ? 'Left ' : 'Right ') : '') + 'heading ' + hdgText(a.value) };

    case 'heading_rel':
      ac.setHeadingRelative(a.value, a.dir);
      return { ok: true, msg: 'Turning ' + a.dir + ' ' + a.value + ' degrees' };

    case 'present_heading':
      ac.setHeading(ac.heading, null);
      return { ok: true, msg: 'Present heading, ' + hdgText(ac.heading) };

    case 'altitude': {
      if (a.value > 41000 || a.value < 0) return { ok: false, msg: 'Unable, altitude out of range' };
      var verb = a.value > ac.altitude ? 'Climbing and maintain ' : a.value < ac.altitude ? 'Descending and maintain ' : 'Maintaining ';
      ac.setAltitude(a.value);
      return { ok: true, msg: verb + a.value };
    }

    case 'speed': {
      if (a.value < 60 || a.value > 400) return { ok: false, msg: 'Unable, speed out of range' };
      if (ac.altitude < LOW_ALT_CEILING && a.value > MAX_LOW_ALT_SPEED) {
        return { ok: false, msg: 'Unable, 250 knots below one-zero-thousand' };
      }
      ac.setSpeed(a.value);
      return { ok: true, msg: (a.value > ac.speed ? 'Increasing speed to ' : 'Reducing speed to ') + a.value };
    }

    case 'present_speed':
      ac.setPresentSpeed();
      return { ok: true, msg: 'Maintaining present speed' };

    case 'normal_speed':
      ac.resumeNormalSpeed();
      return { ok: true, msg: 'Resuming normal speed' };

    case 'direct': {
      var fix1 = findFix(a.fix);
      if (!fix1) return { ok: false, msg: 'Unable, no such fix ' + a.fix };
      if (ac.mode === 'approach') this._cancelApproach(ac);
      ac.setDirect(fix1);
      return { ok: true, msg: 'Direct ' + fix1.name };
    }

    case 'hold': {
      var fix2 = findFix(a.fix);
      if (!fix2) return { ok: false, msg: 'Unable, no such fix ' + a.fix };
      if (ac.mode === 'approach') this._cancelApproach(ac);
      ac.setHold(fix2);
      return { ok: true, msg: 'Holding at ' + fix2.name + ', right turns' };
    }

    case 'route': {
      var routeNames = [];
      for (var ri = 0; ri < a.fixes.length; ri++) {
        var rf = findFix(a.fixes[ri]);
        if (!rf) return { ok: false, msg: 'Unable, no such fix ' + a.fixes[ri] };
        routeNames.push(rf.name);
      }
      if (ac.mode === 'approach') this._cancelApproach(ac);
      ac.setRoute(routeNames);
      return { ok: true, msg: 'Cleared via ' + routeNames.join(' ') };
    }

    case 'clear_approach':
    case 'clear_land': {
      if (ac.role !== 'arrival') return { ok: false, msg: 'Unable, not inbound' };
      if (ac.mode === 'landed' || ac.mode === 'onground') return { ok: false, msg: 'Unable, already down' };
      var landRwy = a.rwy ? this._resolveRunway(a.rwy) : (ac.assignedRunway || AIRPORT.runways[0]);
      if (a.rwy && !landRwy) return { ok: false, msg: 'Unable, no runway ' + a.rwy + ' here' };
      var dist = distanceBetween(ac.x, ac.y, landRwy.threshold.x, landRwy.threshold.y);
      if (dist > 45) return { ok: false, msg: 'Unable, too far out' };
      ac.assignedRunway = landRwy;
      ac.clearedToLand = true;
      ac.clearedApproach = true;
      return { ok: true, msg: a.type === 'clear_land' ? 'Cleared to land, runway ' + landRwy.id : 'Cleared for the approach, runway ' + landRwy.id };
    }

    case 'clear_takeoff': {
      if (ac.role !== 'departure') return { ok: false, msg: 'Unable, not a departure' };
      if (ac.mode !== 'onground') return { ok: false, msg: 'Unable, already airborne' };
      var toRwy = a.rwy ? this._resolveRunway(a.rwy) : (ac.assignedRunway || AIRPORT.runways[0]);
      if (a.rwy && !toRwy) return { ok: false, msg: 'Unable, no runway ' + a.rwy + ' here' };
      if (toRwy.occupiedUntil > this.simTime) return { ok: false, msg: 'Unable, runway occupied' };
      ac.assignedRunway = toRwy;
      ac.mode = 'departRoll';
      ac.targetSpeed = 200;
      ac.targetAltitude = Math.min(ac.filedAltitude, AIRPORT.elevation + 5000);
      toRwy.occupiedUntil = this.simTime + 40;
      this.stats.departures++;
      return { ok: true, msg: 'Cleared for takeoff, runway ' + toRwy.id };
    }

    case 'go_around': {
      var r = ac.commandGoAround(this);
      if (!r.ok) return { ok: false, msg: 'Unable, ' + r.msg };
      return { ok: true, msg: 'Going around' };
    }

    case 'contact_tower':
      return { ok: true, msg: 'Contact tower' };

    case 'contact_center':
      return this._handleContactCenter(ac);

    case 'contact_auto':
      return ac.role === 'departure' ? this._handleContactCenter(ac) : { ok: true, msg: 'Contact tower' };

    case 'squawk':
      ac.squawk = a.value;
      return { ok: true, msg: 'Squawk ' + a.value };

    case 'ident':
      return { ok: true, msg: 'Squawking ident' };

    case 'say':
      if (a.what === 'altitude') return { ok: true, msg: 'Altitude ' + Math.round(ac.altitude) };
      if (a.what === 'assigned_altitude') return { ok: true, msg: 'Assigned altitude ' + Math.round(ac.targetAltitude) };
      if (a.what === 'heading') return { ok: true, msg: 'Heading ' + hdgText(ac.heading) };
      if (a.what === 'assigned_heading') return { ok: true, msg: 'Assigned heading ' + hdgText(ac.targetHeading) };
      if (a.what === 'assigned_speed') return { ok: true, msg: 'Assigned speed ' + Math.round(ac.targetSpeed) };
      return { ok: true, msg: 'Speed ' + Math.round(ac.speed) };

    default:
      return { ok: false, msg: 'Unable' };
  }
};

// ---- conflict detection ----
// true when both aircraft are established (captured) on separate runways that
// share a heading (parallel strips) and each is tracking close to its own
// centerline — the real-world condition for independent parallel approaches
Game.prototype._onIndependentParallels = function (ac1, ac2) {
  if (ac1.mode !== 'approach' || ac2.mode !== 'approach') return false;
  var r1 = ac1.assignedRunway, r2 = ac2.assignedRunway;
  if (!r1 || !r2 || r1 === r2 || r1.heading !== r2.heading) return false;
  var f1 = runwayFrame(ac1.x, ac1.y, r1);
  var f2 = runwayFrame(ac2.x, ac2.y, r2);
  return Math.abs(f1.cross) < 1.5 && Math.abs(f2.cross) < 1.5;
};

Game.prototype._checkConflicts = function () {
  var list = this.aircraft.filter(function (ac) {
    return ac.mode !== 'onground' && ac.mode !== 'landed' && ac.mode !== 'exited';
  });
  for (var i = 0; i < list.length; i++) list[i].conflict = false;

  var seen = {};
  for (var a = 0; a < list.length; a++) {
    for (var b = a + 1; b < list.length; b++) {
      var ac1 = list[a], ac2 = list[b];
      var hdist = distanceBetween(ac1.x, ac1.y, ac2.x, ac2.y);
      var vdist = Math.abs(ac1.altitude - ac2.altitude);
      var key = ac1.id < ac2.id ? ac1.id + '-' + ac2.id : ac2.id + '-' + ac1.id;

      // independent parallel approaches: both established on separate parallel
      // localizers aren't a conflict just for flying side by side — that's the
      // entire point of parallel runway spacing
      if (this._onIndependentParallels(ac1, ac2)) {
        delete this.activeConflicts[key];
        continue;
      }

      if (hdist < 0.3 && vdist < 200) {
        this.log('MID-AIR COLLISION: ' + ac1.callsign + ' and ' + ac2.callsign, 'bad');
        this.penalize(100, 'collision between ' + ac1.callsign + ' and ' + ac2.callsign);
        ac1.removable = true; ac1.removeReason = 'collision';
        ac2.removable = true; ac2.removeReason = 'collision';
        delete this.activeConflicts[key];
        continue;
      }

      if (hdist < 3 && vdist < 1000) {
        ac1.conflict = true; ac2.conflict = true;
        seen[key] = true;
        if (!this.activeConflicts[key]) {
          this.activeConflicts[key] = true;
          this.penalize(25, 'loss of separation: ' + ac1.callsign + ' and ' + ac2.callsign);
        }
      }
    }
  }
  for (var k in this.activeConflicts) {
    if (!seen[k]) delete this.activeConflicts[k];
  }
};

// ---- strips / stats UI ----
var MODE_LABELS = {
  enroute: 'enroute', holding: 'holding', approach: 'on approach',
  onground: 'ready', departRoll: 'takeoff roll', climbout: 'climbing out',
  goaround: 'going around', landed: 'landed', exited: 'handed off'
};

Game.prototype.refreshStrips = function () {
  var self = this;
  var container = this.dom.strips;
  container.innerHTML = '';
  var sorted = this.aircraft.slice().sort(function (a, b) {
    if (a.role !== b.role) return a.role === 'departure' ? 1 : -1;
    return distanceBetween(a.x, a.y, 0, 0) - distanceBetween(b.x, b.y, 0, 0);
  });
  sorted.forEach(function (ac) {
    var row = document.createElement('div');
    row.className = 'strip ' + ac.role + (ac.callsign === self.selectedCallsign ? ' selected' : '') + (ac.conflict ? ' conflict' : '');
    var extra = ac.role === 'departure'
      ? ('RWY ' + (ac.assignedRunway ? ac.assignedRunway.id : '?') + ' &rarr; ' + ac.assignedFix + ' FL' + Math.round(ac.filedAltitude / 100))
      : (ac.assignedRunway ? ('RWY ' + ac.assignedRunway.id) : '');
    row.innerHTML =
      '<div class="strip-cs">' + ac.callsign + '<span class="strip-type">' + ac.typeInfo.code + '</span></div>' +
      '<div class="strip-nums">' + pad3n(ac.altitude / 100) + ' / ' + pad3n(ac.targetAltitude / 100) + '&nbsp;&nbsp;' + hdgText(ac.heading) + '&deg;&nbsp;&nbsp;' + Math.round(ac.speed) + 'kt</div>' +
      '<div class="strip-status">' + (MODE_LABELS[ac.mode] || ac.mode) + ' ' + extra + '</div>';
    row.addEventListener('click', function () {
      self.selectedCallsign = ac.callsign;
      self.dom.input.value = ac.callsign + ' ';
      self.dom.input.focus();
      self.refreshStrips();
    });
    container.appendChild(row);
  });
};

Game.prototype.refreshStats = function () {
  this.dom.score.textContent = this.score;
  this.dom.statLandings.textContent = this.stats.landings;
  this.dom.statDepartures.textContent = this.stats.departures;
  this.dom.statIncidents.textContent = this.stats.incidents;
  this.dom.clock.textContent = fmtClock(this.simTime);
};

// ---- main loop ----
Game.prototype.tick = function (dt) {
  this.simTime += dt;

  this.spawnTimer -= dt;
  if (this.spawnTimer <= 0 && this.aircraft.length < this.maxAircraft) {
    if (Math.random() < 0.5) this.spawnArrival(); else this.spawnDeparture();
    this.spawnTimer = randRange(35, 75);
  }

  for (var i = 0; i < this.aircraft.length; i++) {
    this.aircraft[i].update(dt, this);
  }

  this._checkConflicts();

  for (var j = this.aircraft.length - 1; j >= 0; j--) {
    var ac = this.aircraft[j];
    if (ac.removable) {
      if (ac.removeReason === 'left-area') {
        this.penalize(8, ac.callsign + ' left the area without landing');
      } else if (ac.removeReason === 'departed-unhandled') {
        this.penalize(5, ac.callsign + ' left frequency without contact');
      } else if (ac.removeReason === 'collision') {
        // already logged in conflict check
      }
      releaseCallsign(ac.callsign);
      this.aircraft.splice(j, 1);
    }
  }

  this.refreshStats();
  this.dom.clock.textContent = fmtClock(this.simTime);
};

Game.prototype.frame = function (now) {
  if (this._lastFrame === null) this._lastFrame = now;
  var realDt = Math.min((now - this._lastFrame) / 1000, 0.25);
  this._lastFrame = now;

  if (!this.paused) {
    this.tick(realDt * this.timeMultiplier);
  }

  this.radar.draw(this.aircraft, this.selectedCallsign);
  if (this.profile && this.dom.profileWrap && !this.dom.profileWrap.classList.contains('hidden')) {
    this.profile.draw(this.aircraft, this.selectedCallsign);
  }

  this._stripTimer += realDt;
  if (this._stripTimer >= 0.35) {
    this._stripTimer = 0;
    this.refreshStrips();
  }

  var self = this;
  requestAnimationFrame(function (t) { self.frame(t); });
};

Game.prototype.start = function () {
  var self = this;
  requestAnimationFrame(function (t) { self.frame(t); });
};
