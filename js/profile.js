// Side (profile) view: distance-to-threshold vs. altitude, with the active
// runway's glideslope drawn in, so it's easy to see who's high/low on the approach.
//
// The y-axis is raw altitude (same units as everywhere else in the game — strips,
// data blocks, command readbacks), not height-above-field, so a plane commanded to
// "80" (8000ft) actually plots next to the 8k gridline instead of appearing offset
// by the field elevation.

function ProfileView(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.xMaxNm = 25;
  this._resize();
  var self = this;
  if (window.ResizeObserver) {
    new ResizeObserver(function () { self._resize(); }).observe(canvas);
  } else {
    window.addEventListener('resize', function () { self._resize(); });
  }
}

ProfileView.prototype._resize = function () {
  var dpr = window.devicePixelRatio || 1;
  var rect = this.canvas.getBoundingClientRect();
  this.canvas.width = Math.max(1, rect.width * dpr);
  this.canvas.height = Math.max(1, rect.height * dpr);
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.cssW = rect.width;
  this.cssH = rect.height;
  this.padL = 52; this.padB = 28; this.padT = 26; this.padR = 24;
  this.plotW = Math.max(1, this.cssW - this.padL - this.padR);
  this.plotH = Math.max(1, this.cssH - this.padT - this.padB);
};

// distance = nm to threshold, alt = raw altitude (ft), same units as ac.altitude
ProfileView.prototype.toXY = function (distance, alt) {
  var d = Math.max(0, Math.min(this.xMaxNm, distance));
  var a = Math.max(0, Math.min(this.yMaxAlt, alt));
  return {
    x: this.padL + (1 - d / this.xMaxNm) * this.plotW,
    y: this.padT + (1 - a / this.yMaxAlt) * this.plotH,
    clamped: distance > this.xMaxNm || distance < 0 || alt > this.yMaxAlt
  };
};

ProfileView.prototype.draw = function (aircraftList, selectedCallsign) {
  if (this.cssW < 2 || this.cssH < 2) return;
  this.yMaxAlt = Math.ceil((AIRPORT.elevation + 8000) / 1000) * 1000; // raw altitude, ft — airport can change at runtime

  var selectedAc = aircraftList.filter(function (a) { return a.callsign === selectedCallsign; })[0];
  var runway = (selectedAc && selectedAc.assignedRunway) || AIRPORT.runways[0];

  var ctx = this.ctx;
  ctx.clearRect(0, 0, this.cssW, this.cssH);
  ctx.fillStyle = '#081018';
  ctx.fillRect(0, 0, this.cssW, this.cssH);

  var groundY = this.toXY(0, AIRPORT.elevation).y;

  // altitude gridlines, in clean round raw-altitude marks
  ctx.strokeStyle = 'rgba(120,150,170,0.15)';
  ctx.fillStyle = 'rgba(150,175,190,0.7)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (var alt = 0; alt <= this.yMaxAlt; alt += 2000) {
    var p = this.toXY(this.xMaxNm, alt);
    if (p.y > groundY + 1) continue; // below field elevation — skip, ground fill covers it
    ctx.beginPath();
    ctx.moveTo(this.padL, p.y);
    ctx.lineTo(this.padL + this.plotW, p.y);
    ctx.stroke();
    ctx.fillText((alt / 1000) + 'k', 4, p.y + 4);
  }

  // distance ticks
  for (var d = 0; d <= this.xMaxNm; d += 5) {
    var pt = this.toXY(d, AIRPORT.elevation);
    ctx.beginPath();
    ctx.moveTo(pt.x, groundY);
    ctx.lineTo(pt.x, groundY + 4);
    ctx.stroke();
    if (d > 0) ctx.fillText(d + 'nm', pt.x - 11, this.cssH - 8);
  }

  // glideslope (3deg, ~300ft/nm above field elevation)
  var gsFar = this.toXY(this.xMaxNm, Math.min(this.yMaxAlt, AIRPORT.elevation + this.xMaxNm * 300));
  var gsNear = this.toXY(0, AIRPORT.elevation);
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(57, 192, 255, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(gsFar.x, gsFar.y);
  ctx.lineTo(gsNear.x, gsNear.y);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(57, 192, 255, 0.9)';
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.fillText('3° glidepath', gsFar.x - 20, gsFar.y - 8);

  // ground
  ctx.fillStyle = '#1a2a1f';
  ctx.fillRect(this.padL, groundY, this.plotW, this.cssH - this.padB - groundY);
  ctx.strokeStyle = '#3c5468';
  ctx.beginPath();
  ctx.moveTo(this.padL, groundY);
  ctx.lineTo(this.padL + this.plotW, groundY);
  ctx.stroke();

  // runway marker at threshold (right edge)
  ctx.fillStyle = '#eaeaea';
  ctx.fillRect(this.padL + this.plotW - 3, groundY - 3, 3, 3);
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.fillText('RW' + runway.id, this.padL + this.plotW - 40, groundY - 8);

  // aircraft — only those using this same runway (distance-to-threshold is only
  // meaningful relative to one runway at a time)
  for (var i = 0; i < aircraftList.length; i++) {
    var ac = aircraftList[i];
    if (ac.role !== 'arrival') continue;
    if (ac.mode === 'landed' || ac.mode === 'exited' || ac.mode === 'onground') continue;
    if ((ac.assignedRunway || AIRPORT.runways[0]) !== runway) continue;
    var frame = runwayFrame(ac.x, ac.y, runway);
    var pos = this.toXY(frame.along, ac.altitude);
    var selected = ac.callsign === selectedCallsign;
    var color = ac.conflict ? '#ff3b3b' : (MODE_COLORS[ac.mode] || '#39e08a');

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, selected ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = selected ? '#fff' : color;
    ctx.font = (selected ? 'bold ' : '') + '12px ui-monospace, monospace';
    ctx.fillText(ac.callsign, pos.x + 8, pos.y - 6);
  }
};
