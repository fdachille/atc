// Aircraft entity: state + per-tick physics/autopilot update.

var AC_ID_SEQ = 1;

function bearingTo(fromX, fromY, toX, toY) {
  var dx = toX - fromX, dy = toY - fromY;
  var deg = Math.atan2(dx, dy) * 180 / Math.PI;
  return (deg + 360) % 360;
}

function distanceBetween(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function normalizeHeading(h) {
  return ((h % 360) + 360) % 360;
}

// signed shortest angular diff a-b, in (-180,180]
function angleDiff(a, b) {
  var d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Position (x,y) expressed in a runway's own approach frame: along = distance
// behind the threshold on the extended centerline (positive = still inbound),
// cross = perpendicular deviation from the centerline (nm). Works for any
// threshold position/heading, not just one sitting on the world x-axis.
function runwayFrame(x, y, runway) {
  var rad = runway.heading * Math.PI / 180;
  var fwdX = Math.sin(rad), fwdY = Math.cos(rad); // unit vector in the landing direction
  var dx = x - runway.threshold.x, dy = y - runway.threshold.y;
  return {
    along: -(dx * fwdX + dy * fwdY),
    cross: dx * fwdY - dy * fwdX
  };
}

function Aircraft(opts) {
  this.id = AC_ID_SEQ++;
  this.callsign = opts.callsign;
  this.typeInfo = opts.typeInfo;
  this.role = opts.role; // 'arrival' | 'departure'
  this.x = opts.x;
  this.y = opts.y;
  this.altitude = opts.altitude;
  this.heading = opts.heading;
  this.speed = opts.speed;

  this.targetHeading = opts.heading;
  this.turnDirection = null; // 'left' | 'right' | null(shortest)
  this.targetAltitude = opts.altitude;
  this.targetSpeed = opts.speed;
  this.speedLocked = false; // 'maintain present speed'

  this.directFix = null;
  this.holdFix = null;

  this.mode = opts.mode || 'enroute'; // enroute, holding, approach, landed, onground, departRoll, climbout, exited, goaround
  this.clearedToLand = false;
  this.clearedApproach = false;
  this.captured = false;

  this.assignedFix = opts.assignedFix || null; // departures: filed exit fix
  this.filedAltitude = opts.filedAltitude || null;
  this.assignedRunway = opts.assignedRunway || null; // which of AIRPORT.runways this aircraft is using
  this.route = []; // remaining fix names to fly after directFix, in order (multi-leg "route" clearance)

  this.squawk = opts.squawk || '1200';
  this.conflict = false;
  this.trail = [];
  this.trailTimer = 0;
  this.spawnTime = opts.spawnTime || 0;
  this.removable = false;
  this.removeReason = null;
}

Aircraft.prototype.currentSpeedCap = function () {
  var cap = Infinity;
  if (this.altitude < LOW_ALT_CEILING) cap = MAX_LOW_ALT_SPEED;
  return cap;
};

Aircraft.prototype.setHeading = function (value, dir) {
  this.directFix = null;
  this.holdFix = null;
  this.route = [];
  if (this.mode === 'holding') this.mode = 'enroute';
  this.targetHeading = normalizeHeading(value);
  this.turnDirection = dir || null;
};

Aircraft.prototype.setHeadingRelative = function (deg, dir) {
  this.directFix = null;
  this.holdFix = null;
  this.route = [];
  if (this.mode === 'holding') this.mode = 'enroute';
  var delta = dir === 'left' ? -deg : deg;
  this.targetHeading = normalizeHeading(this.heading + delta);
  this.turnDirection = dir;
};

Aircraft.prototype.setAltitude = function (value) {
  this.targetAltitude = value;
};

Aircraft.prototype.setSpeed = function (value) {
  this.speedLocked = false;
  this.targetSpeed = value;
};

Aircraft.prototype.setPresentSpeed = function () {
  this.speedLocked = true;
  this.targetSpeed = this.speed;
};

Aircraft.prototype.resumeNormalSpeed = function () {
  this.speedLocked = false;
  this.targetSpeed = this.mode === 'approach' ? this.typeInfo.approachSpeed : this.typeInfo.cruiseSpeed;
};

Aircraft.prototype.setDirect = function (fix) {
  this.directFix = fix.name;
  this.holdFix = null;
  this.route = [];
  if (this.mode === 'holding') this.mode = 'enroute';
  this.turnDirection = null;
};

Aircraft.prototype.setHold = function (fix) {
  this.holdFix = fix.name;
  this.directFix = fix.name; // fly to it first, then orbit
  this.route = [];
};

// fixNames: ordered list of fix name strings to fly leg by leg
Aircraft.prototype.setRoute = function (fixNames) {
  this.holdFix = null;
  this.route = fixNames.slice(1);
  this.directFix = fixNames[0] || null;
  if (this.mode === 'holding') this.mode = 'enroute';
  this.turnDirection = null;
};

// ---- physics ----
Aircraft.prototype.update = function (dt, world) {
  if (this.mode === 'landed' || this.mode === 'exited') return;

  this._updateAutopilotTargets(world);
  this._turnToward(dt);
  this._climbToward(dt);
  this._accelToward(dt);
  this._move(dt);
  this._updateTrail(dt);
  this._checkModeTransitions(world);
};

Aircraft.prototype._updateAutopilotTargets = function (world) {
  var t = this.typeInfo;

  // direct-to navigation: continuously re-aim at the fix
  if (this.directFix && this.mode !== 'approach') {
    var fix = findFix(this.directFix);
    if (fix) {
      var d = distanceBetween(this.x, this.y, fix.x, fix.y);
      if (d < 1.2) {
        if (this.holdFix === this.directFix) {
          this.mode = 'holding';
          this.directFix = null; // now orbiting; heading handled below
        } else if (this.route.length > 0) {
          this.directFix = this.route.shift(); // next leg of the route
        } else {
          this.directFix = null; // reached, continue on last heading
        }
      } else {
        this.targetHeading = bearingTo(this.x, this.y, fix.x, fix.y);
        this.turnDirection = null;
      }
    }
  }

  if (this.mode === 'holding') {
    // simplified hold: continuous standard-rate right turns around the fix
    this.turnDirection = 'right';
    this.targetHeading = normalizeHeading(this.heading + 90);
  }

  // enforce 250kt below 10,000ft unless already faster and decelerating naturally
  var cap = this.currentSpeedCap();
  if (!this.speedLocked && this.targetSpeed > cap) {
    this.targetSpeed = cap;
  }

  // approach autopilot
  if (this.mode === 'approach') {
    var rwy = this.assignedRunway || AIRPORT.runways[0];
    var biasedCourse = rwy.heading;
    var frame = runwayFrame(this.x, this.y, rwy);
    var corr = Math.max(-20, Math.min(20, frame.cross * 25));
    this.targetHeading = normalizeHeading(biasedCourse - corr);
    this.turnDirection = null;
    var distToThreshold = Math.max(0, frame.along);
    this.targetAltitude = Math.max(AIRPORT.elevation, distToThreshold * 300 + AIRPORT.elevation);
    if (!this.speedLocked) this.targetSpeed = t.approachSpeed;
  }

  if (this.mode === 'departRoll' || this.mode === 'climbout') {
    this.targetHeading = (this.assignedRunway || AIRPORT.runways[0]).heading;
    this.turnDirection = null;
  }
};

Aircraft.prototype._turnToward = function (dt) {
  if (this.mode === 'onground' || this.mode === 'departRoll') return;
  var rate = this.typeInfo.turnRate * dt;
  var diff = angleDiff(this.targetHeading, this.heading);
  if (Math.abs(diff) < 0.05) {
    this.heading = this.targetHeading;
    return;
  }
  if (this.turnDirection === 'left') {
    var leftDiff = diff <= 0 ? diff : diff - 360;
    var step = Math.max(leftDiff, -rate);
    this.heading = normalizeHeading(this.heading + step);
  } else if (this.turnDirection === 'right') {
    var rightDiff = diff >= 0 ? diff : diff + 360;
    var step2 = Math.min(rightDiff, rate);
    this.heading = normalizeHeading(this.heading + step2);
  } else {
    var step3 = Math.max(-rate, Math.min(rate, diff));
    this.heading = normalizeHeading(this.heading + step3);
  }
};

Aircraft.prototype._climbToward = function (dt) {
  var diff = this.targetAltitude - this.altitude;
  if (Math.abs(diff) < 1) { this.altitude = this.targetAltitude; return; }
  var rate = (diff > 0 ? this.typeInfo.climbRate : this.typeInfo.descentRate) * dt;
  if (Math.abs(diff) <= rate) this.altitude = this.targetAltitude;
  else this.altitude += diff > 0 ? rate : -rate;
  if (this.altitude < 0) this.altitude = 0;
};

Aircraft.prototype._accelToward = function (dt) {
  var diff = this.targetSpeed - this.speed;
  if (Math.abs(diff) < 0.5) { this.speed = this.targetSpeed; return; }
  var rate = this.typeInfo.accel * dt;
  if (Math.abs(diff) <= rate) this.speed = this.targetSpeed;
  else this.speed += diff > 0 ? rate : -rate;
  if (this.speed < 0) this.speed = 0;
};

Aircraft.prototype._move = function (dt) {
  if (this.mode === 'onground') return;
  var nmPerSec = this.speed / 3600;
  var rad = this.heading * Math.PI / 180;
  this.x += Math.sin(rad) * nmPerSec * dt;
  this.y += Math.cos(rad) * nmPerSec * dt;
};

Aircraft.prototype._updateTrail = function (dt) {
  this.trailTimer += dt;
  if (this.trailTimer >= 8) {
    this.trailTimer = 0;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 6) this.trail.shift();
  }
};

Aircraft.prototype._checkModeTransitions = function (world) {
  var t = this.typeInfo;

  // ---- approach capture logic ----
  if (this.clearedToLand && this.mode !== 'approach' && this.mode !== 'landed' && this.mode !== 'goaround') {
    var capRwy = this.assignedRunway || AIRPORT.runways[0];
    var capFrame = runwayFrame(this.x, this.y, capRwy);
    var along = capFrame.along, cross = capFrame.cross;
    if (along > 0.6 && along < 16) {
      var courseDiff = Math.abs(angleDiff(this.heading, capRwy.heading));
      var gsAlt = along * 300 + AIRPORT.elevation;
      var withinCourse = courseDiff <= 30 && Math.abs(cross) < 2.2; // standard max localizer intercept angle
      var withinAlt = this.altitude <= gsAlt + 600 && this.altitude >= gsAlt - 400;
      if (withinCourse && withinAlt) {
        this.mode = 'approach';
        this.captured = true;
        world.log(this.callsign + ' established on the localizer, runway ' + capRwy.id, 'info');
      }
    } else if (along <= 0.6 && this.mode !== 'approach') {
      this._goAround(world, 'missed the approach');
    }
  }

  if (this.mode === 'approach') {
    var lndRwy = this.assignedRunway || AIRPORT.runways[0];
    var lndFrame = runwayFrame(this.x, this.y, lndRwy);
    if (lndFrame.along <= 0.15 || this.altitude <= AIRPORT.elevation + 15) {
      this.mode = 'landed';
      this.removable = true;
      this.removeReason = 'landed';
      world.onLanded(this);
    }
  }

  // ---- departure roll -> climbout ----
  if (this.mode === 'departRoll') {
    if (this.speed >= 90) {
      this.mode = 'climbout';
    }
  }
  if (this.mode === 'climbout' && this.altitude > AIRPORT.elevation + 200) {
    this.mode = 'enroute';
  }
  if (this.mode === 'goaround' && this.altitude >= this.targetAltitude - 5) {
    this.mode = 'enroute';
  }

  // ---- boundary checks ----
  var dist = distanceBetween(this.x, this.y, 0, 0);
  if (dist > AIRSPACE_RADIUS && this.mode !== 'onground' && this.mode !== 'departRoll') {
    this.removable = true;
    this.removeReason = this.role === 'departure' ? 'departed-unhandled' : 'left-area';
  }
};

Aircraft.prototype._goAround = function (world, reason) {
  this.clearedToLand = false;
  this.clearedApproach = false;
  this.captured = false;
  this.mode = 'goaround';
  this.targetHeading = (this.assignedRunway || AIRPORT.runways[0]).heading;
  this.turnDirection = null;
  this.targetAltitude = AIRPORT.elevation + 3000;
  this.targetSpeed = this.typeInfo.cruiseSpeed * 0.7;
  this.speedLocked = false;
  world.log(this.callsign + ' going around, ' + reason, 'warn');
  world.penalize(10, this.callsign + ' missed approach');
};

Aircraft.prototype.commandGoAround = function (world) {
  if (this.mode !== 'approach' && this.mode !== 'goaround') {
    return { ok: false, msg: 'not on the approach' };
  }
  this._goAround(world, 'going around');
  this.mode = 'enroute';
  return { ok: true };
};

Aircraft.prototype.groundSpeedText = function () {
  return Math.round(this.speed) + 'kt';
};
