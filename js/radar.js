// Canvas rendering of the radar scope.

function Radar(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.selectedId = null;
  this.zoom = 1;
  this.center = { x: 0, y: 0 }; // nm, world point rendered at screen center
  this._resize();
  var self = this;
  if (window.ResizeObserver) {
    new ResizeObserver(function () { self._resize(); }).observe(canvas);
  } else {
    window.addEventListener('resize', function () { self._resize(); });
  }
  this._bindInteraction();
}

Radar.prototype._resize = function () {
  var dpr = window.devicePixelRatio || 1;
  var rect = this.canvas.getBoundingClientRect();
  this.canvas.width = rect.width * dpr;
  this.canvas.height = rect.height * dpr;
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.cssW = rect.width;
  this.cssH = rect.height;
  this.cx = rect.width / 2;
  this.cy = rect.height / 2;
  var margin = 30;
  this.baseScale = (Math.min(rect.width, rect.height) / 2 - margin) / AIRSPACE_RADIUS;
  this.scale = this.baseScale * this.zoom;
};

Radar.prototype.toScreen = function (x, y) {
  return { x: this.cx + (x - this.center.x) * this.scale, y: this.cy - (y - this.center.y) * this.scale };
};

Radar.prototype.toWorld = function (px, py) {
  return { x: (px - this.cx) / this.scale + this.center.x, y: -(py - this.cy) / this.scale + this.center.y };
};

Radar.prototype.zoomAt = function (px, py, factor) {
  var before = this.toWorld(px, py);
  this.zoom = Math.max(0.4, Math.min(10, this.zoom * factor));
  this.scale = this.baseScale * this.zoom;
  var after = this.toWorld(px, py);
  this.center.x += before.x - after.x;
  this.center.y += before.y - after.y;
};

Radar.prototype.panByPixels = function (dx, dy) {
  this.center.x -= dx / this.scale;
  this.center.y += dy / this.scale;
};

Radar.prototype.resetView = function () {
  this.zoom = 1;
  this.scale = this.baseScale;
  this.center.x = 0;
  this.center.y = 0;
};

Radar.prototype._bindInteraction = function () {
  var self = this;
  var canvas = this.canvas;
  var dragging = false, dragged = false, lastX = 0, lastY = 0;

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    self.zoomAt(mx, my, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  canvas.addEventListener('mousedown', function (e) {
    dragging = true; dragged = false;
    lastX = e.clientX; lastY = e.clientY;
  });

  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
    if (dragged) {
      self.panByPixels(dx, dy);
      lastX = e.clientX; lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mouseup', function () {
    if (dragging) canvas.style.cursor = 'crosshair';
    dragging = false;
  });

  canvas.addEventListener('dblclick', function () {
    self.resetView();
  });

  this.wasDragged = function () { return dragged; };
};

Radar.prototype.draw = function (aircraftList, selectedCallsign) {
  var ctx = this.ctx;
  var w = this.cssW, h = this.cssH;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#031a12';
  ctx.fillRect(0, 0, w, h);

  this._drawRings(ctx);
  this._drawCompass(ctx);
  this._drawRunway(ctx);
  this._drawFixes(ctx);

  for (var i = 0; i < aircraftList.length; i++) {
    this._drawAircraft(ctx, aircraftList[i], aircraftList[i].callsign === selectedCallsign);
  }
};

Radar.prototype._drawRings = function (ctx) {
  var origin = this.toScreen(0, 0);
  ctx.strokeStyle = 'rgba(60, 200, 140, 0.25)';
  ctx.lineWidth = 1;
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(60, 200, 140, 0.35)';
  for (var r = 10; r <= AIRSPACE_RADIUS; r += 10) {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r * this.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(r + 'nm', origin.x + 4, origin.y - r * this.scale - 2);
  }
  // crosshair, centered on the airport (nm origin), not the screen
  ctx.beginPath();
  ctx.moveTo(origin.x - AIRSPACE_RADIUS * this.scale, origin.y);
  ctx.lineTo(origin.x + AIRSPACE_RADIUS * this.scale, origin.y);
  ctx.moveTo(origin.x, origin.y - AIRSPACE_RADIUS * this.scale);
  ctx.lineTo(origin.x, origin.y + AIRSPACE_RADIUS * this.scale);
  ctx.stroke();
};

Radar.prototype._drawCompass = function (ctx) {
  var origin = this.toScreen(0, 0);
  var dirs = [
    { deg: 0, label: 'N 360' },
    { deg: 90, label: 'E 090' },
    { deg: 180, label: 'S 180' },
    { deg: 270, label: 'W 270' }
  ];
  ctx.font = 'bold 11px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(160, 210, 180, 0.8)';
  ctx.textAlign = 'center';
  for (var i = 0; i < dirs.length; i++) {
    var rad = dirs[i].deg * Math.PI / 180;
    var p = this.toScreen(Math.sin(rad) * AIRSPACE_RADIUS, Math.cos(rad) * AIRSPACE_RADIUS);
    var dx = p.x - origin.x, dy = p.y - origin.y;
    var len = Math.hypot(dx, dy) || 1;
    ctx.fillText(dirs[i].label, p.x + (dx / len) * 14, p.y + (dy / len) * 14 + 4);
  }
  ctx.textAlign = 'left';
};

Radar.prototype._drawRunway = function (ctx) {
  for (var i = 0; i < AIRPORT.runways.length; i++) {
    this._drawOneRunway(ctx, AIRPORT.runways[i]);
  }
  var origin = this.toScreen(0, 0);
  ctx.fillStyle = '#eaeaea';
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillText(AIRPORT.icao, origin.x + 8, origin.y - 20);
};

Radar.prototype._drawOneRunway = function (ctx, runway) {
  var rad = runway.heading * Math.PI / 180;
  var fwdX = Math.sin(rad), fwdY = Math.cos(rad);
  var th = runway.threshold;
  var stripLen = 1.2;

  var p1 = this.toScreen(th.x, th.y); // threshold (touchdown point)
  var p2 = this.toScreen(th.x + fwdX * stripLen, th.y + fwdY * stripLen); // far end of pavement
  ctx.strokeStyle = '#eaeaea';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // extended centerline / final approach course (dashed), back the way arrivals come from
  var far = this.toScreen(th.x - fwdX * 16, th.y - fwdY * 16);
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(far.x, far.y);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#eaeaea';
  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  ctx.fillText(runway.id, p1.x + 6, p1.y - 6);
};

Radar.prototype._drawFixes = function (ctx) {
  ctx.fillStyle = 'rgba(120, 190, 255, 0.85)';
  ctx.strokeStyle = 'rgba(120, 190, 255, 0.85)';
  ctx.font = '10px "JetBrains Mono", monospace';
  for (var i = 0; i < FIXES.length; i++) {
    var f = FIXES[i];
    var p = this.toScreen(f.x, f.y);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 5);
    ctx.lineTo(p.x - 5, p.y + 4);
    ctx.lineTo(p.x + 5, p.y + 4);
    ctx.closePath();
    ctx.stroke();
    ctx.fillText(f.name, p.x + 7, p.y + 3);
  }
};

var MODE_COLORS = {
  enroute: '#39e08a',
  holding: '#ffd23f',
  approach: '#39c0ff',
  departRoll: '#ff9f43',
  climbout: '#ff9f43',
  goaround: '#ff5f5f',
  onground: '#888'
};

// draws the selected aircraft's planned path: current directFix, then each
// queued route leg in order, as a dashed line with a dot at each waypoint
Radar.prototype._drawPlannedRoute = function (ctx, ac) {
  if (!ac.directFix) return;
  var legs = [ac.directFix].concat(ac.route || []);
  var points = [this.toScreen(ac.x, ac.y)];
  for (var i = 0; i < legs.length; i++) {
    var fix = findFix(legs[i]);
    if (!fix) break;
    points.push(this.toScreen(fix.x, fix.y));
  }
  if (points.length < 2) return;

  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = 'rgba(255, 210, 63, 0.7)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (var j = 1; j < points.length; j++) ctx.lineTo(points[j].x, points[j].y);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 210, 63, 0.9)';
  for (var k = 1; k < points.length; k++) {
    ctx.beginPath();
    ctx.arc(points[k].x, points[k].y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
};

Radar.prototype._drawAircraft = function (ctx, ac, selected) {
  var p = this.toScreen(ac.x, ac.y);
  var color = ac.conflict ? '#ff3b3b' : (MODE_COLORS[ac.mode] || '#39e08a');

  if (selected) this._drawPlannedRoute(ctx, ac);

  // trail
  ctx.fillStyle = 'rgba(120, 220, 170, 0.35)';
  for (var i = 0; i < ac.trail.length; i++) {
    var tp = this.toScreen(ac.trail[i].x, ac.trail[i].y);
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // heading vector (~1 minute of travel)
  var nmPerMin = ac.speed / 60;
  var rad = ac.heading * Math.PI / 180;
  var vx = p.x + Math.sin(rad) * nmPerMin * this.scale;
  var vy = p.y - Math.cos(rad) * nmPerMin * this.scale;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(vx, vy);
  ctx.stroke();

  // blip
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, selected ? 5 : 3.5, 0, Math.PI * 2);
  ctx.fill();

  if (selected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  // data block — anchored below-right of the dot so it never overlaps the blip
  ctx.font = (selected ? 'bold ' : '') + '11px "JetBrains Mono", monospace';
  ctx.fillStyle = selected ? '#ffffff' : color;
  var alt = Math.round(ac.altitude / 100);
  var line1 = ac.callsign;
  var arrow = ac.targetAltitude > ac.altitude + 50 ? '↑' : (ac.targetAltitude < ac.altitude - 50 ? '↓' : ' ');
  var line2 = pad3(alt) + arrow + ' ' + Math.round(ac.speed);
  ctx.fillText(line1, p.x + 10, p.y + 15);
  ctx.fillText(line2, p.x + 10, p.y + 27);
};

function pad3(n) {
  var s = '' + n;
  while (s.length < 3) s = '0' + s;
  return s;
}
