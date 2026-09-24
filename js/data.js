// Static reference data: airport, fixes, airlines, aircraft types.

// picks one of the 36 real runway headings (01-36, 010deg apart); 0deg (north) is runway 36
function randomRunway() {
  var heading = randInt(0, 35) * 10;
  var num = heading / 10;
  if (num === 0) num = 36;
  var id = (num < 10 ? '0' : '') + num;
  return { id: id, heading: heading, threshold: { x: 0, y: 0 }, occupiedUntil: 0 };
}

var AIRPORT = {
  icao: 'KZXV',
  name: 'Zephyr Intl',
  elevation: 620,
  runways: [randomRunway()] // active runways; randomized each session. AIRPORT.runway (below) is always runways[0]
};
Object.defineProperty(AIRPORT, 'runway', { get: function () { return this.runways[0]; } });

var AIRSPACE_RADIUS = 55; // nm, aircraft outside this are out of radar contact

var DEFAULT_FIX_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

// Lays a list of fix names out around the compass at even bearings, `distance`
// nm out. Used both for our home field's fixes and each imported airport's own.
function buildCompassFixes(names, distance) {
  distance = distance || 45;
  return names.map(function (name, i) {
    var bearing = DEFAULT_FIX_BEARINGS[i % DEFAULT_FIX_BEARINGS.length];
    var rad = bearing * Math.PI / 180;
    return {
      name: name,
      bearing: bearing,
      distance: distance,
      x: Math.sin(rad) * distance,
      y: Math.cos(rad) * distance
    };
  });
}

// Arrivals spawn near these inbound; departures are filed to exit over one of
// them; players route aircraft through them. Swapped out wholesale when a
// LIVE TRAFFIC airport is adopted (see _adoptAirport in game.js).
var FIXES = buildCompassFixes(['NORTH', 'NEAST', 'EAST', 'SEAST', 'SOUTH', 'SWEST', 'WEST', 'NWEST']);

function findFix(name) {
  if (!name) return null;
  var upper = name.toUpperCase();
  for (var i = 0; i < FIXES.length; i++) {
    if (FIXES[i].name === upper) return FIXES[i];
  }
  return null;
}

var AIRLINES = [
  { code: 'DAL', name: 'Delta' },
  { code: 'UAL', name: 'United' },
  { code: 'AAL', name: 'American' },
  { code: 'SWA', name: 'Southwest' },
  { code: 'JBU', name: 'JetBlue' },
  { code: 'ASA', name: 'Alaska' },
  { code: 'FFT', name: 'Frontier' },
  { code: 'FDX', name: 'FedEx' },
  { code: 'UPS', name: 'UPS' },
  { code: 'BAW', name: 'Speedbird' }
];

// turnRate: deg/sec, climbRate/descentRate: ft/sec, accel: kt/sec,
// cruiseSpeed / approachSpeed: kt, cruiseAlt: [min,max] ft
var AIRCRAFT_TYPES = [
  { code: 'B738', category: 'jet', turnRate: 3, climbRate: 32, descentRate: 28, accel: 4, cruiseSpeed: 280, approachSpeed: 145, cruiseAlt: [16000, 34000] },
  { code: 'A320', category: 'jet', turnRate: 3, climbRate: 33, descentRate: 28, accel: 4, cruiseSpeed: 275, approachSpeed: 140, cruiseAlt: [16000, 34000] },
  { code: 'E75L', category: 'regional', turnRate: 3.5, climbRate: 30, descentRate: 26, accel: 4.5, cruiseSpeed: 260, approachSpeed: 135, cruiseAlt: [14000, 30000] },
  { code: 'CRJ2', category: 'regional', turnRate: 3.5, climbRate: 28, descentRate: 25, accel: 4.5, cruiseSpeed: 250, approachSpeed: 130, cruiseAlt: [14000, 28000] },
  { code: 'B77W', category: 'heavy', turnRate: 2.2, climbRate: 22, descentRate: 20, accel: 3, cruiseSpeed: 310, approachSpeed: 155, cruiseAlt: [18000, 38000] },
  { code: 'B763', category: 'heavy', turnRate: 2.4, climbRate: 24, descentRate: 21, accel: 3, cruiseSpeed: 300, approachSpeed: 150, cruiseAlt: [18000, 36000] },
  { code: 'C172', category: 'ga', turnRate: 4.5, climbRate: 11, descentRate: 12, accel: 2.5, cruiseSpeed: 110, approachSpeed: 65, cruiseAlt: [4000, 9000] }
];

var MAX_LOW_ALT_SPEED = 250; // kt, FAA 250kt-below-10000ft rule
var LOW_ALT_CEILING = 10000;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function randRange(min, max) { return min + Math.random() * (max - min); }

var usedCallsigns = {};
function generateCallsign(isGA) {
  var cs;
  var tries = 0;
  do {
    if (isGA) {
      cs = 'N' + randInt(100, 999) + pick(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'X', 'Y', 'Z']);
    } else {
      var airline = pick(AIRLINES);
      cs = airline.code + randInt(1, 999);
    }
    tries++;
  } while (usedCallsigns[cs] && tries < 50);
  usedCallsigns[cs] = true;
  return cs;
}

function releaseCallsign(cs) {
  delete usedCallsigns[cs];
}
