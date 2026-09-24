// Optional feature: pull real, currently-airborne traffic near a random real-world
// airport, adopt that airport's real runway configuration and field elevation as
// our active airport, and drop the traffic into the (now re-centered) airspace at
// its real altitude/heading/speed for the player to control.
//
// Data source: airplanes.live's free public ADS-B API, which serves permissive
// CORS (Access-Control-Allow-Origin: *) so it can be called directly from a static
// page with no backend of our own. It's a best-effort community feed — coverage
// and availability aren't guaranteed, so this always fails soft (a log message),
// never breaks the rest of the sim.

var LIVE_TRAFFIC_RADIUS_NM = 55; // matches AIRSPACE_RADIUS
var LIVE_TRAFFIC_MAX_IMPORT = 12; // aircraft brought in per click
var LIVE_TRAFFIC_TOTAL_CAP = 24; // hard ceiling on total aircraft after import, independent of TRAFFIC difficulty
var LIVE_TRAFFIC_FETCH_TIMEOUT_MS = 8000;

// Lays real runway headings/ids out as distinct, non-overlapping threshold
// positions (nm, relative to the airport reference point). Real parallel runways
// get offset sideways from each other; runways on a different heading get offset
// into their own little cluster. Positions are a plausible approximation, not
// surveyed geometry — good enough for a game, and headings/ids are real.
function layoutRunways(list) {
  var groups = {};
  var order = [];
  list.forEach(function (r) {
    if (!groups[r.heading]) { groups[r.heading] = []; order.push(r.heading); }
    groups[r.heading].push(r);
  });
  var out = [];
  order.forEach(function (heading, gi) {
    var rad = heading * Math.PI / 180;
    var perp = { x: Math.cos(rad), y: -Math.sin(rad) }; // perpendicular to the runway, for parallel spacing
    var groupAngle = gi * 137.5 * Math.PI / 180; // golden-angle spread so clusters don't line up
    var groupR = gi === 0 ? 0 : 0.5;
    var cx = Math.sin(groupAngle) * groupR, cy = Math.cos(groupAngle) * groupR;
    var members = groups[heading];
    var n = members.length;
    members.forEach(function (r, i) {
      var offset = (i - (n - 1) / 2) * 0.4; // nm between parallel strips
      out.push({
        id: r.id,
        heading: heading,
        threshold: { x: cx + perp.x * offset, y: cy + perp.y * offset },
        occupiedUntil: 0
      });
    });
  });
  return out;
}

// elevation: real field elevation, ft MSL. runways: that field's real runways
// (heading + designator per physical strip; parallels/crosswinds included).
// fixes: real charted waypoints (from openscope's airport data), positions
// clamped to 12-48nm from the field so they fit inside our smaller airspace,
// bearing preserved so the real direction of travel still feels right.
var WORLD_AIRPORTS = [
  { icao: 'KJFK', name: 'New York JFK', country: 'USA', lat: 40.6413, lon: -73.7781, elevation: 13,
    runways: layoutRunways([{ id: '04L', heading: 40 }, { id: '04R', heading: 40 }, { id: '08L', heading: 80 }, { id: '13L', heading: 130 }]),
    fixes: [
      { name: 'CAMRN', bearing: 185.8, distance: 37.63, x: -3.78, y: -37.44 },
      { name: 'LENDY', bearing: 315.3, distance: 23.1, x: -16.26, y: 16.41 },
      { name: 'DEEZZ', bearing: 0.0, distance: 28.21, x: 0.01, y: 28.21 },
      { name: 'WAVEY', bearing: 144.4, distance: 30.03, x: 17.47, y: -24.42 },
      { name: 'MERIT', bearing: 33.3, distance: 48.0, x: 26.34, y: 40.12 },
      { name: 'DIXIE', bearing: 208.4, distance: 36.98, x: -17.6, y: -32.53 },
      { name: 'BIGGY', bearing: 256.3, distance: 48.0, x: -46.63, y: -11.4 },
      { name: 'GAYEL', bearing: 330.1, distance: 48.0, x: -23.89, y: 41.63 }
    ] },
  { icao: 'KLAX', name: 'Los Angeles Intl', country: 'USA', lat: 33.9416, lon: -118.4085, elevation: 128,
    runways: layoutRunways([{ id: '06L', heading: 60 }, { id: '06R', heading: 60 }, { id: '25L', heading: 250 }, { id: '25R', heading: 250 }]),
    fixes: [
      { name: 'CHATY', bearing: 334.3, distance: 20.03, x: -8.7, y: 18.04 },
      { name: 'GMN', bearing: 336.5, distance: 48.0, x: -19.17, y: 44.01 },
      { name: 'BAYST', bearing: 292.6, distance: 13.76, x: -12.7, y: 5.28 },
      { name: 'GARDY', bearing: 66.2, distance: 46.82, x: 42.85, y: 18.86 },
      { name: 'BIGBR', bearing: 80.3, distance: 33.99, x: 33.5, y: 5.73 },
      { name: 'VNY', bearing: 346.2, distance: 17.41, x: -4.14, y: 16.91 },
      { name: 'SXC', bearing: 181.0, distance: 34.0, x: -0.56, y: -34.0 },
      { name: 'BASET', bearing: 84.1, distance: 21.52, x: 21.4, y: 2.22 }
    ] },
  { icao: 'KORD', name: "Chicago O'Hare", country: 'USA', lat: 41.9742, lon: -87.9073, elevation: 672,
    runways: layoutRunways([{ id: '04L', heading: 40 }, { id: '09L', heading: 90 }, { id: '10L', heading: 100 }, { id: '27R', heading: 270 }]),
    fixes: [
      { name: 'BENKY', bearing: 111.2, distance: 14.22, x: 13.25, y: -5.15 },
      { name: 'NEWRK', bearing: 230.4, distance: 38.42, x: -29.61, y: -24.48 },
      { name: 'AHSTN', bearing: 232.0, distance: 25.48, x: -20.07, y: -15.69 },
      { name: 'PETAH', bearing: 243.8, distance: 12.07, x: -10.83, y: -5.32 },
      { name: 'VULCN', bearing: 35.6, distance: 12.0, x: 6.99, y: 9.76 },
      { name: 'KURKK', bearing: 322.9, distance: 12.0, x: -7.25, y: 9.56 },
      { name: 'HIMGO', bearing: 68.5, distance: 19.1, x: 17.77, y: 7.01 },
      { name: 'MONKZ', bearing: 138.9, distance: 12.0, x: 7.89, y: -9.04 }
    ] },
  { icao: 'KATL', name: 'Atlanta Hartsfield-Jackson', country: 'USA', lat: 33.6407, lon: -84.4277, elevation: 1026,
    runways: layoutRunways([{ id: '08L', heading: 80 }, { id: '08R', heading: 80 }, { id: '09L', heading: 90 }, { id: '10', heading: 100 }]),
    fixes: [
      { name: 'GRITZ', bearing: 107.1, distance: 12.0, x: 11.47, y: -3.53 },
      { name: 'HYZMN', bearing: 146.0, distance: 12.95, x: 7.24, y: -10.74 },
      { name: 'RIVTT', bearing: 222.6, distance: 17.8, x: -12.05, y: -13.11 },
      { name: 'SNUFY', bearing: 283.7, distance: 12.0, x: -11.66, y: 2.84 },
      { name: 'MPASS', bearing: 293.2, distance: 12.0, x: -11.03, y: 4.73 },
      { name: 'ZELAN', bearing: 322.8, distance: 13.42, x: -8.11, y: 10.69 },
      { name: 'CPARK', bearing: 266.2, distance: 12.0, x: -11.97, y: -0.79 },
      { name: 'VOLTS', bearing: 45.7, distance: 23.84, x: 17.05, y: 16.66 }
    ] },
  { icao: 'KDFW', name: 'Dallas-Fort Worth', country: 'USA', lat: 32.8998, lon: -97.0403, elevation: 607,
    runways: layoutRunways([{ id: '17C', heading: 170 }, { id: '17L', heading: 170 }, { id: '18L', heading: 180 }, { id: '18R', heading: 180 }]),
    fixes: [
      { name: 'AKUNA', bearing: 18.3, distance: 34.82, x: 10.94, y: 33.05 },
      { name: 'BLECO', bearing: 354.0, distance: 33.24, x: -3.47, y: 33.06 },
      { name: 'ZEMMA', bearing: 1.6, distance: 48.0, x: 1.36, y: 47.98 },
      { name: 'ARDIA', bearing: 172.0, distance: 37.24, x: 5.16, y: -36.88 },
      { name: 'WINDU', bearing: 181.5, distance: 48.0, x: -1.24, y: -47.98 },
      { name: 'BSKAT', bearing: 68.7, distance: 48.0, x: 44.71, y: 17.47 },
      { name: 'VKTRY', bearing: 313.8, distance: 41.97, x: -30.3, y: 29.05 },
      { name: 'BOOVE', bearing: 223.5, distance: 42.78, x: -29.45, y: -31.03 }
    ] },
  { icao: 'KSFO', name: 'San Francisco Intl', country: 'USA', lat: 37.6213, lon: -122.3790, elevation: 13,
    runways: layoutRunways([{ id: '28L', heading: 280 }, { id: '28R', heading: 280 }, { id: '01L', heading: 10 }]),
    fixes: [
      { name: 'CIITY', bearing: 115.9, distance: 12.12, x: 10.91, y: -5.29 },
      { name: 'SAHEY', bearing: 116.4, distance: 12.0, x: 10.75, y: -5.33 },
      { name: 'SYRAH', bearing: 69.9, distance: 48.0, x: 45.08, y: 16.49 },
      { name: 'DYAMD', bearing: 87.1, distance: 48.0, x: 47.94, y: 2.39 },
      { name: 'PIRAT', bearing: 226.5, distance: 31.71, x: -23.02, y: -21.82 },
      { name: 'STINS', bearing: 304.1, distance: 21.67, x: -17.95, y: 12.14 },
      { name: 'WESLA', bearing: 298.2, distance: 12.0, x: -10.58, y: 5.67 },
      { name: 'NTELL', bearing: 110.1, distance: 48.0, x: 45.08, y: -16.5 }
    ] },
  { icao: 'EGLL', name: 'London Heathrow', country: 'UK', lat: 51.4700, lon: -0.4543, elevation: 83,
    runways: layoutRunways([{ id: '09L', heading: 90 }, { id: '27R', heading: 270 }]),
    fixes: [
      { name: 'WOD', bearing: 266.3, distance: 15.9, x: -15.87, y: -1.03 },
      { name: 'BUR', bearing: 289.4, distance: 12.0, x: -11.32, y: 3.99 },
      { name: 'CHT', bearing: 345.3, distance: 12.0, x: -3.04, y: 11.61 },
      { name: 'EPM', bearing: 161.2, distance: 12.0, x: 3.87, y: -11.36 },
      { name: 'OCK', bearing: 178.5, distance: 12.0, x: 0.32, y: -12.0 },
      { name: 'LAM', bearing: 65.0, distance: 24.99, x: 22.65, y: 10.57 },
      { name: 'BIG', bearing: 114.6, distance: 20.09, x: 18.28, y: -8.35 },
      { name: 'DET', bearing: 104.2, distance: 40.55, x: 39.3, y: -9.97 }
    ] },
  { icao: 'EDDF', name: 'Frankfurt', country: 'Germany', lat: 50.0379, lon: 8.5622, elevation: 364,
    runways: layoutRunways([{ id: '07L', heading: 70 }, { id: '07C', heading: 70 }, { id: '18', heading: 180 }]),
    fixes: [
      { name: 'FFM', bearing: 72.1, distance: 12.0, x: 11.42, y: 3.69 },
      { name: 'RID', bearing: 182.9, distance: 15.39, x: -0.79, y: -15.37 },
      { name: 'MTR', bearing: 37.6, distance: 18.08, x: 11.03, y: 14.33 },
      { name: 'SPESA', bearing: 109.2, distance: 32.08, x: 30.3, y: -10.54 },
      { name: 'CHA', bearing: 110.8, distance: 19.69, x: 18.41, y: -7.01 },
      { name: 'ANEKI', bearing: 184.2, distance: 43.39, x: -3.17, y: -43.27 },
      { name: 'CINDY', bearing: 125.9, distance: 29.77, x: 24.1, y: -17.47 },
      { name: 'OBOKA', bearing: 312.0, distance: 48.0, x: -35.69, y: 32.1 }
    ] },
  { icao: 'EHAM', name: 'Amsterdam Schiphol', country: 'Netherlands', lat: 52.3105, lon: 4.7683, elevation: -11,
    runways: layoutRunways([{ id: '04', heading: 40 }, { id: '06', heading: 60 }, { id: '09', heading: 90 }, { id: '18L', heading: 180 }]),
    fixes: [
      { name: 'ANDIK', bearing: 35.6, distance: 31.65, x: 18.42, y: 25.73 },
      { name: 'ARNEM', bearing: 105.0, distance: 48.0, x: 46.37, y: -12.41 },
      { name: 'BERGI', bearing: 330.3, distance: 30.28, x: -15.02, y: 26.3 },
      { name: 'IVLUT', bearing: 102.5, distance: 18.36, x: 17.93, y: -3.98 },
      { name: 'LEKKO', bearing: 180.1, distance: 23.18, x: -0.04, y: -23.18 },
      { name: 'LOPIK', bearing: 149.8, distance: 26.35, x: 13.24, y: -22.78 },
      { name: 'LUNIX', bearing: 112.4, distance: 31.62, x: 29.24, y: -12.04 },
      { name: 'PAM', bearing: 83.0, distance: 12.0, x: 11.91, y: 1.46 }
    ] },
  { icao: 'OMDB', name: 'Dubai Intl', country: 'UAE', lat: 25.2532, lon: 55.3657, elevation: 62,
    runways: layoutRunways([{ id: '12L', heading: 120 }, { id: '12R', heading: 120 }]),
    fixes: [
      { name: 'ASTES', bearing: 122.1, distance: 12.0, x: 10.16, y: -6.38 },
      { name: 'GINLA', bearing: 93.4, distance: 48.0, x: 47.91, y: -2.87 },
      { name: 'XARTA', bearing: 240.2, distance: 27.43, x: -23.79, y: -13.64 },
      { name: 'ODLAL', bearing: 292.5, distance: 24.87, x: -22.97, y: 9.53 },
      { name: 'REREK', bearing: 302.0, distance: 16.59, x: -14.07, y: 8.78 },
      { name: 'VELAR', bearing: 108.0, distance: 17.7, x: 16.83, y: -5.47 },
      { name: 'ULDOT', bearing: 121.8, distance: 17.22, x: 14.64, y: -9.07 },
      { name: 'SOLIL', bearing: 290.7, distance: 20.93, x: -19.58, y: 7.4 }
    ] },
  { icao: 'OTHH', name: 'Doha Hamad', country: 'Qatar', lat: 25.2731, lon: 51.6081, elevation: 13,
    runways: layoutRunways([{ id: '16L', heading: 160 }, { id: '16R', heading: 160 }]),
    fixes: [
      { name: 'OBVER', bearing: 174.2, distance: 16.19, x: 1.64, y: -16.11 },
      { name: 'NAKAB', bearing: 153.7, distance: 19.72, x: 8.74, y: -17.68 },
      { name: 'ALSEM', bearing: 80.0, distance: 48.0, x: 47.27, y: 8.34 },
      { name: 'SOKEN', bearing: 341.0, distance: 12.0, x: -3.9, y: 11.35 },
      { name: 'DEMBO', bearing: 8.5, distance: 18.71, x: 2.76, y: 18.5 },
      { name: 'GETAM', bearing: 322.4, distance: 12.0, x: -7.33, y: 9.5 },
      { name: 'ENELI', bearing: 322.7, distance: 17.1, x: -10.35, y: 13.6 },
      { name: 'TUKEN', bearing: 347.0, distance: 21.0, x: -4.71, y: 20.46 }
    ] },
  { icao: 'VHHH', name: 'Hong Kong Intl', country: 'China', lat: 22.3080, lon: 113.9185, elevation: 28,
    runways: layoutRunways([{ id: '07L', heading: 70 }, { id: '07R', heading: 70 }]),
    fixes: [
      { name: 'ROVER', bearing: 70.8, distance: 12.0, x: 11.33, y: 3.96 },
      { name: 'ATENA', bearing: 76.6, distance: 26.71, x: 25.99, y: 6.18 },
      { name: 'PORPA', bearing: 73.7, distance: 12.0, x: 11.52, y: 3.38 },
      { name: 'PRAWN', bearing: 248.1, distance: 12.0, x: -11.14, y: -4.47 },
      { name: 'RUMSY', bearing: 205.0, distance: 14.93, x: -6.32, y: -13.53 },
      { name: 'TUNNA', bearing: 175.2, distance: 31.17, x: 2.58, y: -31.06 },
      { name: 'SHELY', bearing: 107.8, distance: 42.87, x: 40.82, y: -13.1 },
      { name: 'TITAN', bearing: 169.1, distance: 38.72, x: 7.34, y: -38.02 }
    ] },
  { icao: 'RJTT', name: 'Tokyo Haneda', country: 'Japan', lat: 35.5494, lon: 139.7798, elevation: 21,
    runways: layoutRunways([{ id: '04', heading: 40 }, { id: '05', heading: 50 }, { id: '16L', heading: 160 }]),
    fixes: [
      { name: 'BEKLA', bearing: 299.7, distance: 34.32, x: -29.8, y: 17.01 },
      { name: 'RITLA', bearing: 282.2, distance: 32.11, x: -31.38, y: 6.78 },
      { name: 'NINOX', bearing: 264.2, distance: 30.18, x: -30.02, y: -3.07 },
      { name: 'LAXAS', bearing: 159.2, distance: 47.62, x: 16.88, y: -44.53 },
      { name: 'IMOLA', bearing: 205.8, distance: 31.68, x: -13.78, y: -28.53 },
      { name: 'GODIN', bearing: 25.5, distance: 48.0, x: 20.65, y: 43.33 },
      { name: 'POLIX', bearing: 39.1, distance: 48.0, x: 30.26, y: 37.26 },
      { name: 'XAC', bearing: 199.6, distance: 48.0, x: -16.08, y: -45.23 }
    ] },
  { icao: 'RJAA', name: 'Tokyo Narita', country: 'Japan', lat: 35.7647, lon: 140.3864, elevation: 141,
    runways: layoutRunways([{ id: '16L', heading: 160 }, { id: '16R', heading: 160 }]),
    fixes: [
      { name: 'NRE', bearing: 312.3, distance: 12.0, x: -8.87, y: 8.08 },
      { name: 'TETRA', bearing: 275.4, distance: 12.0, x: -11.95, y: 1.13 },
      { name: 'AGRIS', bearing: 331.2, distance: 44.9, x: -21.61, y: 39.36 },
      { name: 'GULBO', bearing: 106.2, distance: 48.0, x: 46.09, y: -13.4 },
      { name: 'OLVAN', bearing: 137.5, distance: 45.64, x: 30.84, y: -33.65 },
      { name: 'LAKES', bearing: 24.9, distance: 13.19, x: 5.55, y: 11.97 },
      { name: 'GEMIN', bearing: 6.5, distance: 12.0, x: 1.37, y: 11.92 },
      { name: 'ELGAR', bearing: 128.5, distance: 23.1, x: 18.07, y: -14.4 }
    ] },
  { icao: 'SBGR', name: 'Sao Paulo Guarulhos', country: 'Brazil', lat: -23.4356, lon: -46.4731, elevation: 2459,
    runways: layoutRunways([{ id: '09L', heading: 90 }, { id: '09R', heading: 90 }]),
    fixes: [
      { name: 'BCO', bearing: 70.1, distance: 12.0, x: 11.28, y: 4.09 },
      { name: 'CGO', bearing: 221.0, distance: 15.25, x: -10.0, y: -11.51 },
      { name: 'IG', bearing: 253.9, distance: 12.0, x: -11.53, y: -3.33 },
      { name: 'TIKTI', bearing: 215.2, distance: 12.0, x: -6.92, y: -9.8 },
      { name: 'EVKUT', bearing: 200.8, distance: 12.0, x: -4.26, y: -11.22 },
      { name: 'SUMRA', bearing: 90.2, distance: 19.43, x: 19.43, y: -0.06 },
      { name: 'ROMIB', bearing: 86.6, distance: 28.16, x: 28.11, y: 1.69 },
      { name: 'GENKO', bearing: 75.9, distance: 42.73, x: 41.45, y: 10.38 }
    ] },
  { icao: 'SAEZ', name: 'Buenos Aires Ezeiza', country: 'Argentina', lat: -34.8222, lon: -58.5358, elevation: 66,
    runways: layoutRunways([{ id: '17', heading: 170 }, { id: '11', heading: 110 }]),
    fixes: [
      { name: 'PTA', bearing: 105.4, distance: 32.6, x: 31.42, y: -8.67 },
      { name: 'ASADA', bearing: 257.2, distance: 48.0, x: -46.8, y: -10.65 },
      { name: 'GEBEM', bearing: 233.5, distance: 38.16, x: -30.69, y: -22.69 },
      { name: 'TORUL', bearing: 234.0, distance: 48.0, x: -38.83, y: -28.22 },
      { name: 'URINO', bearing: 277.7, distance: 48.0, x: -47.57, y: 6.43 },
      { name: 'DORVO', bearing: 82.8, distance: 48.0, x: 47.62, y: 6.04 },
      { name: 'VANAR', bearing: 339.5, distance: 31.88, x: -11.15, y: 29.86 },
      { name: 'PAPIX', bearing: 47.3, distance: 35.9, x: 26.37, y: 24.36 }
    ] }
];

// ICAO aircraft type code -> our AIRCRAFT_TYPES code
var ICAO_TYPE_MAP = {
  B737: 'B738', B738: 'B738', B739: 'B738', B37M: 'B738', B38M: 'B738', B39M: 'B738',
  A320: 'A320', A319: 'A320', A321: 'A320', A20N: 'A320', A21N: 'A320', A318: 'A320',
  E170: 'E75L', E175: 'E75L', E190: 'E75L', E195: 'E75L', E75L: 'E75L', E75S: 'E75L',
  CRJ2: 'CRJ2', CRJ7: 'CRJ2', CRJ9: 'CRJ2', CRJX: 'CRJ2',
  B772: 'B77W', B773: 'B77W', B77W: 'B77W', B77L: 'B77W', A388: 'B77W', B744: 'B77W', B748: 'B77W',
  B763: 'B763', B764: 'B763', B788: 'B763', B789: 'B763', B78X: 'B763',
  A332: 'B763', A333: 'B763', A339: 'B763', A342: 'B763', A343: 'B763', A346: 'B763',
  C172: 'C172', SR22: 'C172', PA28: 'C172', C152: 'C172'
};

function mapLiveAircraftType(icaoType) {
  var code = icaoType && ICAO_TYPE_MAP[icaoType.toUpperCase()];
  if (code) {
    var match = AIRCRAFT_TYPES.filter(function (t) { return t.code === code; })[0];
    if (match) return match;
  }
  return weightedType();
}

// equirectangular approximation — plenty accurate at airspace scale (<100nm)
function latLonToNm(lat, lon, originLat, originLon) {
  var NM_PER_DEG = 60.0;
  return {
    x: (lon - originLon) * NM_PER_DEG * Math.cos(originLat * Math.PI / 180),
    y: (lat - originLat) * NM_PER_DEG
  };
}

function fetchLiveTraffic() {
  var airport = pick(WORLD_AIRPORTS);
  var url = 'https://api.airplanes.live/v2/point/' + airport.lat + '/' + airport.lon + '/' + LIVE_TRAFFIC_RADIUS_NM;

  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, LIVE_TRAFFIC_FETCH_TIMEOUT_MS) : null;

  return fetch(url, controller ? { signal: controller.signal } : {})
    .then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      return { airport: airport, records: (data && data.ac) || [] };
    })
    .catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('timed out');
      throw err;
    });
}
