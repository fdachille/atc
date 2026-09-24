// Command parsing: turns raw text like
//   "DAL123 turn left heading 250, descend and maintain 5000"
// into a callsign + list of structured action objects.

var COMMAND_PATTERNS = [
  { re: /^fly heading (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: null }; } },
  { re: /^heading (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: null }; } },
  { re: /^turn left heading (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: 'left' }; } },
  { re: /^turn right heading (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: 'right' }; } },
  { re: /^turn left (\d{1,3}) degrees?$/, build: function (m) { return { type: 'heading_rel', value: +m[1], dir: 'left' }; } },
  { re: /^turn right (\d{1,3}) degrees?$/, build: function (m) { return { type: 'heading_rel', value: +m[1], dir: 'right' }; } },
  { re: /^fly present heading$/, build: function () { return { type: 'present_heading' }; } },

  { re: /^climb and maintain (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },
  { re: /^climb to (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },
  { re: /^climb (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },
  { re: /^descend and maintain (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },
  { re: /^descend to (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },
  { re: /^descend (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },
  { re: /^maintain (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },

  { re: /^(?:reduce speed to|slow to) (\d{2,3})(?: knots)?$/, build: function (m) { return { type: 'speed', value: +m[1] }; } },
  { re: /^(?:increase speed to|speed up to) (\d{2,3})(?: knots)?$/, build: function (m) { return { type: 'speed', value: +m[1] }; } },
  { re: /^maintain present speed$/, build: function () { return { type: 'present_speed' }; } },
  { re: /^resume normal speed$/, build: function () { return { type: 'normal_speed' }; } },

  { re: /^(?:proceed )?direct (\w+)$/, build: function (m) { return { type: 'direct', fix: m[1].toUpperCase() }; } },
  { re: /^hold at (\w+)$/, build: function (m) { return { type: 'hold', fix: m[1].toUpperCase() }; } },
  { re: /^(?:route|rt) ((?:\w+\s*)+)$/, build: function (m) {
      return { type: 'route', fixes: m[1].trim().split(/\s+/).map(function (s) { return s.toUpperCase(); }) };
    } },

  { re: /^cleared to land(?: runway (\d{2}[lcr]?))?$/, build: function (m) { return { type: 'clear_land', rwy: m[1] ? m[1].toUpperCase() : null }; } },
  { re: /^cleared (?:for )?the approach$/, build: function () { return { type: 'clear_approach' }; } },
  { re: /^cleared (?:ils|for) runway (\d{2}[lcr]?)(?: approach)?$/, build: function (m) { return { type: 'clear_approach', rwy: m[1].toUpperCase() }; } },
  { re: /^cleared for takeoff(?: runway (\d{2}[lcr]?))?$/, build: function (m) { return { type: 'clear_takeoff', rwy: m[1] ? m[1].toUpperCase() : null }; } },
  { re: /^go around$/, build: function () { return { type: 'go_around' }; } },

  { re: /^contact tower$/, build: function () { return { type: 'contact_tower' }; } },
  { re: /^contact (?:center|departure)$/, build: function () { return { type: 'contact_center' }; } },

  { re: /^squawk (\d{4})$/, build: function (m) { return { type: 'squawk', value: m[1] }; } },
  { re: /^ident$/, build: function () { return { type: 'ident' }; } },
  { re: /^say (altitude|heading|speed)$/, build: function (m) { return { type: 'say', what: m[1] }; } },
  { re: /^say assigned (altitude|heading|speed)$/, build: function (m) { return { type: 'say', what: 'assigned_' + m[1] }; } },

  // ---- shorthand aliases (ours) ----
  { re: /^h (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: null }; } },
  { re: /^tl (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: 'left' }; } },
  { re: /^tr (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: 'right' }; } },
  { re: /^ph$/, build: function () { return { type: 'present_heading' }; } },

  { re: /^(?:des|c|cm) (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },

  { re: /^(?:sp|s) (\d{2,3})$/, build: function (m) { return { type: 'speed', value: +m[1] }; } },
  { re: /^ps$/, build: function () { return { type: 'present_speed' }; } },
  { re: /^ns$/, build: function () { return { type: 'normal_speed' }; } },

  { re: /^(?:dct|x) (\w+)$/, build: function (m) { return { type: 'direct', fix: m[1].toUpperCase() }; } },
  { re: /^ho (\w+)$/, build: function (m) { return { type: 'hold', fix: m[1].toUpperCase() }; } },

  { re: /^ld(?: (\d{2}[lcr]?))?$/, build: function (m) { return { type: 'clear_land', rwy: m[1] ? m[1].toUpperCase() : null }; } },
  { re: /^ap(?: (\d{2}[lcr]?))?$/, build: function (m) { return { type: 'clear_approach', rwy: m[1] ? m[1].toUpperCase() : null }; } },
  { re: /^to(?: (\d{2}[lcr]?))?$/, build: function (m) { return { type: 'clear_takeoff', rwy: m[1] ? m[1].toUpperCase() : null }; } },
  { re: /^ga$/, build: function () { return { type: 'go_around' }; } },
  { re: /^ct$/, build: function () { return { type: 'contact_auto' }; } },

  { re: /^sq (\d{4})$/, build: function (m) { return { type: 'squawk', value: m[1] }; } },
  { re: /^id$/, build: function () { return { type: 'ident' }; } },
  { re: /^sa$/, build: function () { return { type: 'say', what: 'altitude' }; } },
  { re: /^sh$/, build: function () { return { type: 'say', what: 'heading' }; } },
  { re: /^ss$/, build: function () { return { type: 'say', what: 'speed' }; } },

  // ---- OpenScope-compatible aliases (openscope.co is the popular sim these mirror) ----
  { re: /^fh (\d{1,3})$/, build: function (m) { return { type: 'heading', value: +m[1], dir: null }; } },
  { re: /^fph$/, build: function () { return { type: 'present_heading' }; } },
  // t l/r: a 3-digit value is an absolute heading, 1-2 digits is a relative turn — same disambiguation OpenScope uses
  { re: /^t ([lr]) (\d{1,3})$/, build: function (m) {
      var dir = m[1] === 'l' ? 'left' : 'right';
      return m[2].length === 3 ? { type: 'heading', value: +m[2], dir: dir } : { type: 'heading_rel', value: +m[2], dir: dir };
    } },

  { re: /^[ad] (\d{1,5})$/, build: function (m) { return { type: 'altitude', value: smartAlt(m[1]) }; } },

  { re: /^\+ ?(\d{2,3})$/, build: function (m) { return { type: 'speed', value: +m[1] }; } },
  { re: /^- ?(\d{2,3})$/, build: function (m) { return { type: 'speed', value: +m[1] }; } },

  { re: /^pd (\w+)$/, build: function (m) { return { type: 'direct', fix: m[1].toUpperCase() }; } },
  { re: /^hold (\w+)$/, build: function (m) { return { type: 'hold', fix: m[1].toUpperCase() }; } },
  { re: /^(?:xh|continue|nohold|cancelhold)$/, build: function () { return { type: 'present_heading' }; } }, // exits hold, same effect as flying present heading

  { re: /^(?:i|ils)(?: (\d{2}[lcr]?))?$/, build: function (m) { return { type: 'clear_approach', rwy: m[1] ? m[1].toUpperCase() : null }; } },
  { re: /^(?:cto|\/)(?: (\d{2}[lcr]?))?$/, build: function (m) { return { type: 'clear_takeoff', rwy: m[1] ? m[1].toUpperCase() : null }; } },

  { re: /^si$/, build: function () { return { type: 'say', what: 'speed' }; } },
  { re: /^saa$/, build: function () { return { type: 'say', what: 'assigned_altitude' }; } },
  { re: /^sah$/, build: function () { return { type: 'say', what: 'assigned_heading' }; } },
  { re: /^sas$/, build: function () { return { type: 'say', what: 'assigned_speed' }; } }
];

// shorthand altitude: values under 1000 are read as hundreds of feet (flight-level style)
function smartAlt(numStr) {
  var n = +numStr;
  return n < 1000 ? n * 100 : n;
}

function parseSegment(segment) {
  var s = segment.trim().replace(/\s+/g, ' ').toLowerCase();
  s = s.replace(/[.]+$/, '');
  for (var i = 0; i < COMMAND_PATTERNS.length; i++) {
    var m = s.match(COMMAND_PATTERNS[i].re);
    if (m) return COMMAND_PATTERNS[i].build(m);
  }
  return null;
}

// returns { ok, callsign, actions, error, badSegment }
function parseCommand(raw) {
  var text = raw.trim();
  if (!text) return { ok: false, error: 'Empty command.' };

  var firstSpace = text.indexOf(' ');
  if (firstSpace === -1) return { ok: false, error: 'No command given for ' + text.toUpperCase() + '.' };

  var callsign = text.slice(0, firstSpace).toUpperCase();
  var rest = text.slice(firstSpace + 1);

  var segments = rest.split(/\s*,\s*|\s+then\s+/i).filter(function (s) { return s.length > 0; });
  if (segments.length === 0) return { ok: false, error: 'No command given for ' + callsign + '.' };

  var actions = [];
  for (var i = 0; i < segments.length; i++) {
    var action = parseSegment(segments[i]);
    if (!action) {
      return { ok: false, error: 'Unrecognized instruction: "' + segments[i].trim() + '"', callsign: callsign };
    }
    actions.push(action);
  }

  return { ok: true, callsign: callsign, actions: actions };
}
