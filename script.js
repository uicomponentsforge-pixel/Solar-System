/* ==========================================================================
   HELIOS · 3D Solar System Explorer
   Three.js r128 · everything procedural (no image assets)

   1  Helpers, noise, state
   2  Scale model + object data
   3  Procedural textures
   4  Renderer, scene, shaders
   5  Bodies (Sun, planets, dwarfs, moons, comets)
   6  Belts, Kuiper, Oort, dust, stars
   7  Scale switching
   8  Camera controller + input
   9  Picking + selection
  10  UI (info, search, compare, dock)
  11  Update loop + init
   ========================================================================== */
(function () {
'use strict';

/* ======================================================================
   1. HELPERS
   ====================================================================== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const fmt = n => Number(n).toLocaleString('en-US');
const tick = () => new Promise(r => setTimeout(r, 0));

const loaderEl = $('#loader'), loaderText = $('#loader-text'), loaderBar = $('#loader-bar');
function progress(f, msg) {
  loaderBar.style.width = Math.round(f * 100) + '%';
  if (msg) loaderText.textContent = msg;
}

if (typeof THREE === 'undefined') {
  loaderText.textContent = 'Three.js could not be loaded. Check your internet connection and reload.';
  return;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260607);
const randn = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd()); };

/* --- 3D value noise (seamless on spheres) --- */
const PERM = new Uint8Array(512), VAL = new Float32Array(256);
(function () {
  const r = mulberry32(90210), p = [];
  for (let i = 0; i < 256; i++) { p.push(i); VAL[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const a = PERM[X] + Y, aa = PERM[a] + Z, ab = PERM[a + 1] + Z;
  const b = PERM[X + 1] + Y, ba = PERM[b] + Z, bb = PERM[b + 1] + Z;
  const c000 = VAL[PERM[aa]], c001 = VAL[PERM[aa + 1]], c010 = VAL[PERM[ab]], c011 = VAL[PERM[ab + 1]];
  const c100 = VAL[PERM[ba]], c101 = VAL[PERM[ba + 1]], c110 = VAL[PERM[bb]], c111 = VAL[PERM[bb + 1]];
  const x00 = c000 + (c100 - c000) * u, x01 = c001 + (c101 - c001) * u;
  const x10 = c010 + (c110 - c010) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}
function fbm(x, y, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s / n;
}

/* --- app state --- */
const state = {
  scale: 'edu',            // 'edu' | 'rel'
  playing: true,
  speed: 1,
  cameraMode: 'follow',    // 'free' | 'follow'
  selected: null,
  toggles: { orbits: true, labels: true, moons: true, asteroids: true, comets: true, kuiper: true, oort: true }
};

/* ======================================================================
   2. SCALE MODEL + DATA
   ====================================================================== */
const REL_AU = 110;      // relative scale: scene units per AU
const AU_MKM = 149.598;  // million km per AU

// Educational scale: smooth, monotonic mapping from AU to scene units
const AU_ANCHORS = [[0, 14], [0.387, 28], [0.723, 40], [1, 54], [1.524, 70], [2.77, 97], [5.2, 135], [9.58, 180],
  [19.2, 225], [30.07, 265], [39.5, 320], [43.1, 342], [45.8, 358], [67.8, 440], [100, 520], [250, 700]];
function eduDist(au) {
  const A = AU_ANCHORS;
  for (let i = 1; i < A.length; i++) {
    if (au <= A[i][0]) return A[i - 1][1] + (A[i][1] - A[i - 1][1]) * ((au - A[i - 1][0]) / (A[i][0] - A[i - 1][0]));
  }
  const n = A.length, s = (A[n - 1][1] - A[n - 2][1]) / (A[n - 1][0] - A[n - 2][0]);
  return A[n - 1][1] + (au - A[n - 1][0]) * s;
}
const distOf = au => (state.scale === 'edu' ? eduDist(au) : au * REL_AU);
const relRadius = d => Math.max(d.cat === 'moon' ? 0.04 : 0.05, d.diamKm / 2 / 6371 * 0.8);

const SUN_DEF = {
  id: 'sun', name: 'Sun', cat: 'star', type: 'G-type main-sequence star', color: '#ffb454',
  diamKm: 1392700, massKg: 1.989e30, g: 274, rotH: 609.1, tilt: 0, moonsLabel: '8 planets',
  periodText: '≈ 230 million years (one lap around the Milky Way)',
  temp: 'Surface ≈ 5,500 °C · Core ≈ 15,000,000 °C',
  desc: 'The star at the center of the Solar System. Nuclear fusion in its core turns hydrogen into helium and powers every world that orbits it.',
  facts: ['It holds 99.86% of all the mass in the Solar System.', 'Sunlight takes about 8 minutes 20 seconds to reach Earth.', 'Roughly 1.3 million Earths could fit inside it.']
};

const PLANETS = [
  { id: 'mercury', name: 'Mercury', cat: 'planet', type: 'Terrestrial planet', color: '#a79f94', aAU: 0.387, e: 0.206, incl: 9, node: 48, peri: 29,
    periodDays: 87.97, rotH: 1407.6, tilt: 0.03, diamKm: 4879, rEdu: 1.2, massKg: 3.301e23, g: 3.7, temp: '−180 °C at night to 430 °C by day', moons: 0,
    desc: 'The smallest planet and the closest to the Sun. A cratered, airless world with the widest temperature swings in the Solar System.',
    facts: ['One solar day (sunrise to sunrise) lasts 176 Earth days.', 'Ice survives in permanently shadowed craters near its poles.', 'Its iron core is so large that the planet has shrunk and wrinkled as it cooled.'] },
  { id: 'venus', name: 'Venus', cat: 'planet', type: 'Terrestrial planet', color: '#e3c58a', aAU: 0.723, e: 0.007, incl: 5, node: 76, peri: 55,
    periodDays: 224.7, rotH: -5832.5, tilt: 177.4, diamKm: 12104, rEdu: 2.0, massKg: 4.867e24, g: 8.87, temp: '465 °C at the surface', moons: 0,
    desc: 'Earth’s size-twin, wrapped in thick clouds of sulfuric acid. A runaway greenhouse effect makes it the hottest planet.',
    facts: ['It spins backwards, so the Sun rises in the west.', 'A day on Venus is longer than its year.', 'Surface pressure is about 92 times Earth’s.'] },
  { id: 'earth', name: 'Earth', cat: 'planet', type: 'Terrestrial planet', color: '#3f7fd6', aAU: 1, e: 0.0167, incl: 0, node: 0, peri: 102,
    periodDays: 365.25, rotH: 23.93, tilt: 23.4, diamKm: 12742, rEdu: 2.2, massKg: 5.972e24, g: 9.81, temp: 'Average 15 °C (−89 to 57 °C)', moons: 1,
    desc: 'Our home. The only world known to host life, with liquid oceans, a protective magnetic field and a nitrogen-oxygen atmosphere.',
    facts: ['About 71% of the surface is covered by ocean.', 'A 23.4° axial tilt gives us the seasons.', 'The Moon steadies Earth’s tilt over millions of years.'] },
  { id: 'mars', name: 'Mars', cat: 'planet', type: 'Terrestrial planet', color: '#c1633f', aAU: 1.524, e: 0.093, incl: 3.5, node: 49, peri: 286,
    periodDays: 687, rotH: 24.62, tilt: 25.2, diamKm: 6779, rEdu: 1.6, massKg: 6.417e23, g: 3.71, temp: 'Average −63 °C (−140 to 20 °C)', moons: 2,
    desc: 'A cold desert world with polar ice caps, dry river valleys and the tallest volcano known in the Solar System.',
    facts: ['Olympus Mons rises about 22 km, nearly three times the height of Everest.', 'Iron-oxide dust gives the planet its rusty color.', 'A Martian day (sol) lasts 24 h 37 min.'] },
  { id: 'jupiter', name: 'Jupiter', cat: 'planet', type: 'Gas giant', color: '#d9b38c', aAU: 5.204, e: 0.049, incl: 3, node: 100, peri: 274,
    periodDays: 4332.6, rotH: 9.93, tilt: 3.1, diamKm: 139820, rEdu: 6, massKg: 1.898e27, g: 24.79, temp: '−110 °C at the cloud tops', moons: 95,
    desc: 'The largest planet: a giant ball of hydrogen and helium striped with storm bands, home to a storm bigger than Earth.',
    facts: ['The Great Red Spot has raged for centuries and is slowly shrinking.', 'It is more than twice as massive as all other planets combined.', 'Its 10-hour day makes it bulge at the equator.'] },
  { id: 'saturn', name: 'Saturn', cat: 'planet', type: 'Gas giant', color: '#e6d29b', aAU: 9.58, e: 0.057, incl: 4.5, node: 113, peri: 339,
    periodDays: 10759, rotH: 10.7, tilt: 26.7, diamKm: 116460, rEdu: 5.2, massKg: 5.683e26, g: 10.44, temp: '−140 °C at the cloud tops', moons: 274, ringOuter: 2.3,
    desc: 'The ringed jewel of the Solar System. Its rings are made of billions of chunks of water ice, from dust grains to house-sized boulders.',
    facts: ['It is less dense than water; in a big enough bath it would float.', 'The main rings span about 280,000 km but are often only ~10 m thick.', 'A hexagon-shaped jet stream circles its north pole.'] },
  { id: 'uranus', name: 'Uranus', cat: 'planet', type: 'Ice giant', color: '#9fe0e6', aAU: 19.19, e: 0.046, incl: 3.2, node: 74, peri: 96,
    periodDays: 30687, rotH: -17.24, tilt: 97.8, diamKm: 50724, rEdu: 3.4, massKg: 8.681e25, g: 8.87, temp: '−195 °C (down to −224 °C)', moons: 28, ringOuter: 2.05,
    desc: 'A pale cyan ice giant that rolls around the Sun on its side, with faint dark rings and moons named after Shakespeare characters.',
    facts: ['Its axis is tilted 97.8°, so each pole gets 42 years of sunlight, then 42 of darkness.', 'It has the coldest planetary atmosphere measured.', 'Thirteen narrow rings circle it.'] },
  { id: 'neptune', name: 'Neptune', cat: 'planet', type: 'Ice giant', color: '#3d63e0', aAU: 30.07, e: 0.009, incl: 3.5, node: 132, peri: 273,
    periodDays: 60190, rotH: 16.11, tilt: 28.3, diamKm: 49244, rEdu: 3.3, massKg: 1.024e26, g: 11.15, temp: '−200 °C at the cloud tops', moons: 16,
    desc: 'The windiest planet: a deep-blue ice giant with supersonic storms, found by mathematics before it was seen through a telescope.',
    facts: ['Winds reach about 2,000 km/h.', 'It was predicted from Uranus’s orbit and found in 1846.', 'One orbit takes 165 Earth years.'] }
];

const DWARFS = [
  { id: 'ceres', name: 'Ceres', cat: 'dwarf', type: 'Dwarf planet · asteroid belt', color: '#8a8782', aAU: 2.766, e: 0.076, incl: 10.6, node: 80, peri: 73,
    periodDays: 1682, rotH: 9.07, tilt: 4, diamKm: 939, rEdu: 0.9, massKg: 9.38e20, g: 0.28, temp: 'About −105 °C', moons: 0,
    desc: 'The largest object in the asteroid belt and the only dwarf planet in the inner Solar System.',
    facts: ['It holds roughly a third of the belt’s total mass.', 'Bright salt deposits in Occator Crater shine like beacons.', 'NASA’s Dawn probe orbited it in 2015.'] },
  { id: 'pluto', name: 'Pluto', cat: 'dwarf', type: 'Dwarf planet · Kuiper Belt', color: '#c9a78a', aAU: 39.48, e: 0.249, incl: 17.2, node: 110, peri: 114,
    periodDays: 90560, rotH: -153.3, tilt: 122.5, diamKm: 2377, rEdu: 1.3, massKg: 1.303e22, g: 0.62, temp: 'About −230 °C', moons: 5,
    desc: 'A frozen world of nitrogen glaciers and water-ice mountains. Its orbit is tilted and so stretched that it dips inside Neptune’s.',
    facts: ['A heart-shaped nitrogen glacier, Tombaugh Regio, covers part of its surface.', 'It was reclassified as a dwarf planet in 2006.', 'New Horizons flew past it in July 2015.'] },
  { id: 'eris', name: 'Eris', cat: 'dwarf', type: 'Dwarf planet · scattered disc', color: '#d9dbe0', aAU: 67.8, e: 0.44, incl: 44, node: 36, peri: 151,
    periodDays: 203830, rotH: 25.9, tilt: 0, diamKm: 2326, rEdu: 1.25, massKg: 1.66e22, g: 0.82, temp: 'About −240 °C', moons: 1,
    desc: 'The most massive known dwarf planet, orbiting far above the plane of the planets on a highly stretched path.',
    facts: ['It is about 27% more massive than Pluto.', 'Its discovery in 2005 pushed astronomers to define “planet”.', 'Its moon is called Dysnomia.'] },
  { id: 'haumea', name: 'Haumea', cat: 'dwarf', type: 'Dwarf planet · Kuiper Belt', color: '#e2e6ee', aAU: 43.13, e: 0.195, incl: 28.2, node: 122, peri: 239,
    periodDays: 103410, rotH: 3.92, tilt: 0, diamKm: 1560, rEdu: 1.0, ell: [1.45, 0.85, 0.95], massKg: 4.006e21, g: 0.401, temp: 'About −241 °C', moons: 2,
    desc: 'A fast-spinning, egg-shaped world of almost pure water ice, ringed and accompanied by two small moons.',
    facts: ['It spins once in under four hours, stretching it into a football shape.', 'A ring was discovered around it in 2017.', 'Its moons are Hiʻiaka and Namaka.'] },
  { id: 'makemake', name: 'Makemake', cat: 'dwarf', type: 'Dwarf planet · Kuiper Belt', color: '#c58a62', aAU: 45.79, e: 0.159, incl: 29, node: 79, peri: 297,
    periodDays: 111845, rotH: 22.8, tilt: 0, diamKm: 1430, rEdu: 1.05, massKg: 3.1e21, g: 0.5, temp: 'About −239 °C', moons: 1,
    desc: 'A reddish, methane-frosted world discovered just after Easter 2005.',
    facts: ['It is named after the creator god of the Rapa Nui people.', 'Its red-brown surface comes from frozen methane and ethane.', 'It is one of the brightest objects in the Kuiper Belt.'] }
];

// k = orbit radius in units of parent radius (compressed for display)
const MOONS = [
  { id: 'moon', parent: 'earth', name: 'Moon', type: 'Moon of Earth', color: '#b7b7b9', orbitKm: 384400, k: 3.4, periodDays: 27.32, incl: 5.1, followTilt: false,
    diamKm: 3474, rEdu: 0.55, massKg: 7.342e22, g: 1.62, temp: '−173 °C at night to 127 °C by day',
    desc: 'Earth’s only natural satellite, probably formed when a Mars-sized body struck the young Earth.',
    facts: ['It always shows the same face to Earth.', 'It drifts away from us about 3.8 cm every year.', 'Twelve people have walked on it.'] },
  { id: 'phobos', parent: 'mars', name: 'Phobos', type: 'Moon of Mars', color: '#7a6f66', orbitKm: 9376, k: 1.9, periodDays: 0.319, incl: 1, followTilt: true,
    diamKm: 22.2, rEdu: 0.13, ell: [1.3, 0.95, 1.0], massKg: 1.07e16, g: 0.0057, temp: 'About −40 °C',
    desc: 'The larger, inner moon of Mars, a lumpy captured-asteroid look-alike.',
    facts: ['It circles Mars three times a day.', 'It is slowly spiralling inward and may break up in ~50 million years.'] },
  { id: 'deimos', parent: 'mars', name: 'Deimos', type: 'Moon of Mars', color: '#8c8279', orbitKm: 23463, k: 2.8, periodDays: 1.263, incl: 2, followTilt: true,
    diamKm: 12.4, rEdu: 0.1, ell: [1.2, 0.9, 1.0], massKg: 1.48e15, g: 0.003, temp: 'About −40 °C',
    desc: 'The smaller, outer moon of Mars, smooth because dust fills its craters.',
    facts: ['It is only about 12 km across.', 'Seen from Mars it looks like a bright star.'] },
  { id: 'io', parent: 'jupiter', name: 'Io', type: 'Moon of Jupiter', color: '#e6c95a', orbitKm: 421700, k: 2.0, periodDays: 1.769, incl: 0.5, followTilt: true,
    diamKm: 3643, rEdu: 0.6, massKg: 8.93e22, g: 1.8, temp: 'Surface ≈ −143 °C; volcanic vents above 1,600 °C',
    desc: 'The most volcanically active world known, squeezed and heated by Jupiter’s tides.',
    facts: ['It has 400+ active volcanoes.', 'Lava fountains can reach hundreds of kilometers high.', 'Its sulfur-rich surface is yellow, orange and black.'] },
  { id: 'europa', parent: 'jupiter', name: 'Europa', type: 'Moon of Jupiter', color: '#d9cdb8', orbitKm: 671100, k: 2.6, periodDays: 3.551, incl: 1, followTilt: true,
    diamKm: 3122, rEdu: 0.5, massKg: 4.8e22, g: 1.31, temp: 'About −160 °C at the surface',
    desc: 'An ice-covered moon hiding a global salty ocean beneath its cracked shell.',
    facts: ['Its ocean may hold twice as much water as all of Earth’s.', 'Brown cracks across the ice trace tidal flexing.', 'NASA’s Europa Clipper is heading there.'] },
  { id: 'ganymede', parent: 'jupiter', name: 'Ganymede', type: 'Moon of Jupiter', color: '#9a8e80', orbitKm: 1070400, k: 3.3, periodDays: 7.155, incl: 1.5, followTilt: true,
    diamKm: 5268, rEdu: 0.85, massKg: 1.482e23, g: 1.43, temp: 'About −163 °C',
    desc: 'The largest moon in the Solar System, bigger than Mercury and the only moon with its own magnetic field.',
    facts: ['It is larger than the planet Mercury.', 'It may hold more water than all Earth’s oceans.', 'It has aurorae of its own.'] },
  { id: 'callisto', parent: 'jupiter', name: 'Callisto', type: 'Moon of Jupiter', color: '#5e5750', orbitKm: 1882700, k: 4.2, periodDays: 16.69, incl: 2, followTilt: true,
    diamKm: 4821, rEdu: 0.75, massKg: 1.076e23, g: 1.24, temp: 'About −139 °C',
    desc: 'A dark, ancient, heavily cratered moon; one of the most cratered surfaces known.',
    facts: ['Its surface may be four billion years old.', 'It sits outside Jupiter’s harshest radiation belts.'] },
  { id: 'titan', parent: 'saturn', name: 'Titan', type: 'Moon of Saturn', color: '#d9a24a', orbitKm: 1221870, k: 4.6, periodDays: 15.945, incl: 0.5, followTilt: true,
    diamKm: 5150, rEdu: 0.85, massKg: 1.345e23, g: 1.35, temp: '−179 °C at the surface',
    desc: 'The only moon with a dense atmosphere, and the only other world known with stable lakes on its surface, of liquid methane and ethane.',
    facts: ['Its air pressure is about 1.5 times Earth’s at sea level.', 'NASA’s Dragonfly rotorcraft is planned to fly there.', 'Huygens landed on it in 2005.'] },
  { id: 'enceladus', parent: 'saturn', name: 'Enceladus', type: 'Moon of Saturn', color: '#f2f6fa', orbitKm: 238020, k: 2.9, periodDays: 1.37, incl: 1, followTilt: true,
    diamKm: 504, rEdu: 0.24, massKg: 1.08e20, g: 0.113, temp: '−198 °C at the surface',
    desc: 'A small, brilliant white moon that sprays plumes of water ice from cracks near its south pole.',
    facts: ['Its geysers feed Saturn’s E ring.', 'A salty ocean lies beneath its ice.', 'It reflects almost all the sunlight that hits it.'] },
  { id: 'triton', parent: 'neptune', name: 'Triton', type: 'Moon of Neptune', color: '#d9c3be', orbitKm: 354760, k: 3.2, periodDays: 5.877, incl: 157, followTilt: true,
    diamKm: 2707, rEdu: 0.6, massKg: 2.14e22, g: 0.78, temp: '−235 °C',
    desc: 'A large moon orbiting backwards, likely a captured Kuiper Belt object, with nitrogen geysers.',
    facts: ['Its retrograde orbit hints that it was captured.', 'It is one of the coldest places measured in the Solar System.', 'It is slowly spiralling toward Neptune.'] },
  { id: 'miranda', parent: 'uranus', name: 'Miranda', type: 'Moon of Uranus', color: '#a3a6ab', orbitKm: 129390, k: 2.9, periodDays: 1.413, incl: 1, followTilt: true,
    diamKm: 471, rEdu: 0.26, massKg: 6.59e19, g: 0.079, temp: 'About −187 °C',
    desc: 'A patchwork moon with giant fault canyons and terraced cliffs.',
    facts: ['Verona Rupes may be the tallest cliff known, around 20 km.', 'Its jumbled terrain suggests it was shattered and reassembled.'] },
  { id: 'titania', parent: 'uranus', name: 'Titania', type: 'Moon of Uranus', color: '#9d928a', orbitKm: 435910, k: 3.6, periodDays: 8.706, incl: 1, followTilt: true,
    diamKm: 1577, rEdu: 0.4, massKg: 3.4e21, g: 0.38, temp: 'About −203 °C',
    desc: 'The largest moon of Uranus, a cratered world cut by huge canyons.',
    facts: ['It is named after the queen of the fairies in A Midsummer Night’s Dream.', 'Its canyons are up to 1,500 km long.'] },
  { id: 'oberon', parent: 'uranus', name: 'Oberon', type: 'Moon of Uranus', color: '#8f857d', orbitKm: 583520, k: 4.3, periodDays: 13.463, incl: 1.5, followTilt: true,
    diamKm: 1523, rEdu: 0.38, massKg: 3.08e21, g: 0.35, temp: 'About −203 °C',
    desc: 'The outermost large moon of Uranus, old, dark and heavily cratered.',
    facts: ['Some crater floors are covered in dark material.', 'Only Voyager 2 has seen it up close, in 1986.'] },
  { id: 'charon', parent: 'pluto', name: 'Charon', type: 'Moon of Pluto', color: '#9b9894', orbitKm: 19591, k: 2.4, periodDays: 6.387, incl: 0.5, followTilt: true,
    diamKm: 1212, rEdu: 0.6, massKg: 1.586e21, g: 0.288, temp: 'About −220 °C',
    desc: 'Pluto’s giant companion, half its width. The two are tidally locked and face each other forever.',
    facts: ['Pluto and Charon orbit a point in the space between them.', 'Its reddish north pole is stained by gases escaping from Pluto.'] }
];

// q, Q = perihelion / aphelion in AU
const COMETS = [
  { id: 'halley', name: 'Halley', cat: 'comet', type: 'Periodic comet', color: '#8ff3e6', q: 0.586, Q: 35.1, incl: 162.3, node: 59, peri: 112,
    periodDays: 27500, rotH: 52.8, tilt: 0, diamKm: 11, massKg: 2.2e14, gText: 'Negligible (about 0.0005 m/s²)',
    temp: 'Varies widely with distance from the Sun',
    desc: 'The most famous comet. It orbits the Sun backwards, returning to the inner Solar System roughly every 76 years.',
    facts: ['It has been recorded since at least 240 BC.', 'The next perihelion is due in 2061.', 'Europe’s Giotto probe photographed its nucleus in 1986.'] },
  { id: 'hale-bopp', name: 'Hale–Bopp', cat: 'comet', type: 'Long-period comet', color: '#8ff3e6', q: 0.914, Q: 370, incl: 89.4, node: 282, peri: 130,
    periodDays: 925000, rotH: 11.4, tilt: 0, diamKm: 60, gText: 'Negligible',
    temp: 'Varies widely with distance from the Sun',
    desc: 'A giant comet on a near-polar orbit. Its 1997 visit was one of the most widely seen comets in history.',
    facts: ['It was visible to the naked eye for about 18 months.', 'Its nucleus is roughly 60 km wide, unusually large.', 'It will not return for about 2,500 years.'] },
  { id: 'encke', name: 'Encke', cat: 'comet', type: 'Periodic comet', color: '#8ff3e6', q: 0.336, Q: 4.1, incl: 11.8, node: 334, peri: 187,
    periodDays: 1204, rotH: 11, tilt: 0, diamKm: 4.8, gText: 'Negligible',
    temp: 'Varies widely with distance from the Sun',
    desc: 'The comet with the shortest known period, looping around the Sun every 3.3 years inside Jupiter’s orbit.',
    facts: ['It is the parent of the Taurid meteor showers.', 'NASA’s MESSENGER imaged its tail from Mercury orbit.'] },
  { id: '67p', name: '67P/Churyumov–Gerasimenko', cat: 'comet', type: 'Jupiter-family comet', color: '#8ff3e6', q: 1.24, Q: 5.68, incl: 7, node: 36, peri: 22,
    periodDays: 2353, rotH: 12.4, tilt: 0, diamKm: 4.1, gText: 'Negligible',
    temp: 'Varies widely with distance from the Sun',
    desc: 'The “rubber duck” comet, visited by ESA’s Rosetta orbiter and Philae lander.',
    facts: ['Philae made the first soft landing on a comet in 2014.', 'Its two-lobed shape probably came from two comets merging gently.'] },
  { id: 'swift-tuttle', name: 'Swift–Tuttle', cat: 'comet', type: 'Periodic comet', color: '#8ff3e6', q: 0.96, Q: 51.2, incl: 113.5, node: 139, peri: 153,
    periodDays: 48500, rotH: null, tilt: 0, diamKm: 26, gText: 'Negligible',
    temp: 'Varies widely with distance from the Sun',
    desc: 'The source of the Perseid meteor shower. At 26 km wide it is the largest object known to cross Earth’s orbit repeatedly.',
    facts: ['Every August Earth passes through the dust it left behind.', 'It returns about every 133 years; next in 2126.'] }
];

/* ======================================================================
   3. PROCEDURAL TEXTURES
   ====================================================================== */
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function canvasFromFn(w, h, fn) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data, o = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = (x + 0.5) / w * TAU;
      o[3] = 255;
      fn(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat, lon, o);
      const i = (y * w + x) * 4;
      d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function pal(stops, t, o) {
  if (t <= stops[0][0]) { const c = stops[0][1]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; return; }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], k = (t - a[0]) / (b[0] - a[0]);
      o[0] = a[1][0] + (b[1][0] - a[1][0]) * k; o[1] = a[1][1] + (b[1][1] - a[1][1]) * k; o[2] = a[1][2] + (b[1][2] - a[1][2]) * k;
      return;
    }
  }
  const c = stops[stops.length - 1][1]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
}

function addCraters(canvas, count, maxR, seed) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, r = mulberry32(1000 + Math.floor(seed * 97));
  for (let i = 0; i < count; i++) {
    const cx = r() * w, cy = (0.12 + 0.76 * r()) * h, rad = (0.004 + Math.pow(r(), 2.6) * maxR) * w;
    for (const ox of [-w, 0, w]) {
      const x = cx + ox;
      if (x + rad < 0 || x - rad > w) continue;
      const g = ctx.createRadialGradient(x + rad * 0.15, cy + rad * 0.15, rad * 0.1, x, cy, rad);
      g.addColorStop(0, 'rgba(0,0,0,0.32)'); g.addColorStop(0.7, 'rgba(0,0,0,0.12)');
      g.addColorStop(0.88, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, rad, 0, TAU); ctx.fill();
    }
  }
}
function addSpots(canvas, count, maxR, rgba, seed) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, r = mulberry32(5000 + Math.floor(seed * 31));
  for (let i = 0; i < count; i++) {
    const x = r() * w, y = (0.2 + 0.6 * r()) * h, rad = (0.004 + r() * maxR) * w;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
  }
}
function addCracks(canvas, count, rgba, width, seed) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, r = mulberry32(7000 + Math.floor(seed * 13));
  ctx.strokeStyle = rgba; ctx.lineWidth = width; ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = r() * w, y = (0.15 + 0.7 * r()) * h, a = r() * TAU;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 14; s++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * w * 0.012; y += Math.sin(a) * w * 0.006; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

function surfaceTex(w, h, o) {
  const sc = o.scale || 2, oct = o.oct || 5, seed = o.seed || 1, con = o.contrast || 2.2, det = o.detail == null ? 0.16 : o.detail;
  const sx = seed * 17.31, sy = seed * 5.77, sz = seed * 11.13, cap = o.cap;
  const c = canvasFromFn(w, h, (nx, ny, nz, lat, lon, out) => {
    let t = (fbm(nx * sc + sx, ny * sc + sy, nz * sc + sz, oct) - 0.5) * con + 0.5;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    pal(o.stops, t, out);
    const dd = 1 + (fbm(nx * sc * 6 + sy, ny * sc * 6 + sz, nz * sc * 6 + sx, 2) - 0.5) * det * 2;
    out[0] *= dd; out[1] *= dd; out[2] *= dd;
    if (cap) {
      let k = (Math.abs(lat) - cap.lat) / cap.soft + (noise3(nx * 7 + sx, ny * 7, nz * 7 + sz) - 0.5) * 0.8;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      if (k > 0) { out[0] = lerp(out[0], cap.color[0], k); out[1] = lerp(out[1], cap.color[1], k); out[2] = lerp(out[2], cap.color[2], k); }
    }
  });
  if (o.craters) addCraters(c, o.craters, o.craterMax || 0.04, seed);
  return c;
}

function bandedTex(w, h, o) {
  // gas / ice giants: latitude bands with turbulence
  return canvasFromFn(w, h, (nx, ny, nz, lat, lon, out) => {
    const warp = (fbm(nx * 3 + o.seed, ny * 9, nz * 3 + o.seed * 2, 4) - 0.5) * o.warp;
    const t = ny + warp;
    const b = Math.sin(t * o.f1) * 0.5 + Math.sin(t * o.f2 + 1.7) * 0.25 + Math.sin(t * o.f3 + 0.4) * 0.25;
    let v = b * 0.5 + 0.5;
    const streak = fbm(nx * 2.2 + o.seed, ny * 38, nz * 2.2, 3);
    v = v * (1 - o.streak) + streak * o.streak * 2 * 0.5 + 0.0;
    v = clamp((v - 0.45) * o.contrast + 0.5, 0, 1);
    pal(o.stops, v, out);
    if (o.cloud) {
      const cl = fbm(nx * 2 + 5, ny * 22, nz * 2 + 9, 4);
      const k = clamp((cl - o.cloud) * 6, 0, 1) * 0.55;
      out[0] = lerp(out[0], 235, k); out[1] = lerp(out[1], 240, k); out[2] = lerp(out[2], 255, k);
    }
  });
}

function earthCanvases() {
  const w = 1024, h = 512, c1 = makeCanvas(w, h), c2 = makeCanvas(w, h);
  const x1 = c1.getContext('2d'), x2 = c2.getContext('2d');
  const i1 = x1.createImageData(w, h), i2 = x2.createImageData(w, h), d1 = i1.data, d2 = i2.data, SEA = 0.545;
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI, cl = Math.cos(lat), ny = Math.sin(lat), al = Math.abs(lat);
    for (let x = 0; x < w; x++) {
      const lon = (x + 0.5) / w * TAU, nx = cl * Math.cos(lon), nz = cl * Math.sin(lon);
      const e = fbm(nx * 1.7 + 3.1, ny * 1.7 + 1.2, nz * 1.7 + 7.7, 6);
      const m = fbm(nx * 2.6 + 9.1, ny * 2.6 + 4.4, nz * 2.6 + 2.2, 4);
      let r, g, b, rough;
      if (e < SEA) {
        const kk = Math.pow(Math.min(1, (SEA - e) / 0.15), 0.6);
        r = lerp(40, 8, kk); g = lerp(120, 36, kk); b = lerp(178, 92, kk); rough = 70;
      } else {
        const hgt = (e - SEA) / 0.2;
        const dry = clamp((0.5 - m) * 4, 0, 1) * (1 - clamp((al - 0.85) * 3, 0, 1));
        const wet = clamp((0.55 - m) * 3, 0, 1);
        const vr = lerp(34, 98, wet), vg = lerp(92, 136, wet), vb = lerp(44, 62, wet);
        r = lerp(vr, 198, dry); g = lerp(vg, 172, dry); b = lerp(vb, 108, dry);
        if (hgt < 0.05) { const s = (1 - hgt / 0.05) * 0.8; r = lerp(r, 206, s); g = lerp(g, 192, s); b = lerp(b, 140, s); }
        if (hgt > 0.4) { const k = clamp((hgt - 0.4) * 2.2, 0, 1); r = lerp(r, 120, k); g = lerp(g, 108, k); b = lerp(b, 94, k); }
        if (hgt > 0.8) { const k = clamp((hgt - 0.8) * 5, 0, 1); r = lerp(r, 244, k); g = lerp(g, 246, k); b = lerp(b, 250, k); }
        rough = 215;
      }
      const ice = clamp((al - 1.16) / 0.1 + (noise3(nx * 8, ny * 8, nz * 8) - 0.5) * 0.7, 0, 1);
      if (ice > 0) { r = lerp(r, 238, ice); g = lerp(g, 244, ice); b = lerp(b, 250, ice); rough = lerp(rough, 150, ice); }
      const i = (y * w + x) * 4;
      d1[i] = r; d1[i + 1] = g; d1[i + 2] = b; d1[i + 3] = 255;
      d2[i] = rough; d2[i + 1] = rough; d2[i + 2] = rough; d2[i + 3] = 255;
    }
  }
  x1.putImageData(i1, 0, 0); x2.putImageData(i2, 0, 0);
  return [c1, c2];
}
function cloudCanvas() {
  return canvasFromFn(1024, 512, (nx, ny, nz, lat, lon, o) => {
    const wx = fbm(nx * 1.5 + 4, ny * 1.5, nz * 1.5 + 1, 3);
    let c = fbm(nx * 2.3 + wx * 1.3, ny * 3.2 + wx * 0.8, nz * 2.3 + wx, 5);
    c += (0.5 + 0.5 * Math.cos(lat * 5) - 0.5) * 0.12;
    o[0] = o[1] = o[2] = 250; o[3] = clamp((c - 0.5) * 4.2, 0, 1) * 235;
  });
}
function venusTex() {
  const S = [[0, [190, 140, 70]], [0.4, [222, 184, 110]], [0.7, [240, 214, 150]], [1, [250, 236, 190]]];
  return canvasFromFn(512, 256, (nx, ny, nz, lat, lon, o) => {
    const wx = fbm(nx * 1.6 + 2, ny * 1.6, nz * 1.6 + 4, 3), wy = fbm(nx * 1.6 + 9, ny * 1.6 + 3, nz * 1.6, 3);
    let t = fbm(nx * 2.2 + wx * 1.8, ny * 4.2 + wy * 1.4, nz * 2.2 + wx * 1.2, 5);
    pal(S, clamp((t - 0.5) * 2.4 + 0.5, 0, 1), o);
  });
}
function jupiterTex() {
  const c = bandedTex(1024, 512, { seed: 3, warp: 0.22, f1: 26, f2: 61, f3: 11.3, streak: 0.3, contrast: 1.7,
    stops: [[0, [120, 78, 52]], [0.2, [176, 120, 80]], [0.4, [220, 188, 150]], [0.6, [236, 220, 190]], [0.8, [200, 150, 105]], [1, [150, 95, 62]]] });
  const ctx = c.getContext('2d'), w = c.width, h = c.height, x = w * 0.62, y = h * (0.5 + 22 / 180), R = w * 0.036;
  ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.8);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, 'rgba(170,52,30,0.95)'); g.addColorStop(0.55, 'rgba(196,84,52,0.9)');
  g.addColorStop(0.82, 'rgba(226,170,130,0.75)'); g.addColorStop(1, 'rgba(226,190,150,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill(); ctx.restore();
  return c;
}
function neptuneTex() {
  const c = bandedTex(512, 256, { seed: 8, warp: 0.12, f1: 14, f2: 33, f3: 7, streak: 0.25, contrast: 1.5, cloud: 0.6,
    stops: [[0, [22, 50, 150]], [0.5, [40, 85, 200]], [1, [90, 140, 235]]] });
  const ctx = c.getContext('2d'), w = c.width, h = c.height;
  ctx.save(); ctx.translate(w * 0.35, h * 0.6); ctx.scale(1, 0.55);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.05);
  g.addColorStop(0, 'rgba(10,25,90,0.85)'); g.addColorStop(1, 'rgba(10,25,90,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w * 0.05, 0, TAU); ctx.fill(); ctx.restore();
  return c;
}
function plutoTex() {
  const c = surfaceTex(512, 256, { seed: 12, scale: 2.6, oct: 6, contrast: 2.4,
    stops: [[0, [92, 62, 44]], [0.4, [160, 120, 90]], [0.75, [210, 184, 150]], [1, [236, 220, 192]]] });
  const ctx = c.getContext('2d'), w = c.width, h = c.height, x = w * 0.5, y = h * 0.42, s = h * 0.09;
  const g = ctx.createRadialGradient(x, y, 0, x, y, s * 2);
  g.addColorStop(0, 'rgba(246,238,225,0.95)'); g.addColorStop(1, 'rgba(240,230,215,0.55)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.3, x, y - s * 0.5);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.3, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
  ctx.fill();
  return c;
}

const TEX = {
  mercury: () => surfaceTex(512, 256, { seed: 1, scale: 3, oct: 6, contrast: 2.4, stops: [[0, [58, 56, 54]], [0.5, [126, 122, 116]], [1, [182, 176, 168]]], craters: 240, craterMax: 0.04 }),
  venus: venusTex,
  mars: () => surfaceTex(512, 256, { seed: 4, scale: 2.4, oct: 6, contrast: 2.8, stops: [[0, [84, 46, 34]], [0.35, [148, 76, 48]], [0.65, [192, 108, 64]], [1, [228, 170, 115]]],
    cap: { lat: 1.22, soft: 0.14, color: [240, 236, 232] }, craters: 70, craterMax: 0.035 }),
  jupiter: jupiterTex,
  saturn: () => bandedTex(512, 256, { seed: 5, warp: 0.1, f1: 20, f2: 44, f3: 9, streak: 0.2, contrast: 1.3,
    stops: [[0, [150, 125, 85]], [0.5, [214, 190, 142]], [1, [240, 226, 185]]] }),
  uranus: () => bandedTex(512, 256, { seed: 6, warp: 0.06, f1: 9, f2: 21, f3: 5, streak: 0.15, contrast: 0.9,
    stops: [[0, [120, 190, 200]], [0.5, [150, 215, 222]], [1, [185, 232, 235]]] }),
  neptune: neptuneTex,
  ceres: () => { const c = surfaceTex(512, 256, { seed: 9, scale: 3, oct: 6, contrast: 2.2, stops: [[0, [56, 56, 58]], [0.5, [104, 102, 100]], [1, [150, 148, 144]]], craters: 200, craterMax: 0.04 });
    addSpots(c, 1, 0.012, 'rgba(255,255,255,0.95)', 9); const ctx = c.getContext('2d'); const g = ctx.createRadialGradient(150, 120, 0, 150, 120, 7); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(140, 110, 20, 20); return c; },
  pluto: plutoTex,
  eris: () => surfaceTex(512, 256, { seed: 14, scale: 2, oct: 4, contrast: 1.6, stops: [[0, [176, 178, 184]], [1, [240, 242, 246]]], craters: 20, craterMax: 0.04 }),
  haumea: () => { const c = surfaceTex(512, 256, { seed: 15, scale: 2.5, oct: 4, contrast: 1.6, stops: [[0, [196, 204, 216]], [1, [248, 250, 255]]] });
    addSpots(c, 1, 0.045, 'rgba(150,60,50,0.7)', 15); return c; },
  makemake: () => surfaceTex(512, 256, { seed: 16, scale: 2.6, oct: 5, contrast: 2.4, stops: [[0, [140, 82, 56]], [0.5, [186, 116, 78]], [1, [216, 164, 124]]], craters: 20, craterMax: 0.04 }),
  moon: () => surfaceTex(512, 256, { seed: 21, scale: 2.2, oct: 6, contrast: 2.6, stops: [[0, [52, 52, 54]], [0.45, [118, 118, 120]], [0.75, [165, 165, 167]], [1, [205, 205, 205]]], craters: 420, craterMax: 0.05 }),
  phobos: () => surfaceTex(256, 128, { seed: 22, scale: 3, oct: 5, stops: [[0, [60, 56, 52]], [1, [130, 120, 110]]], craters: 60, craterMax: 0.09 }),
  deimos: () => surfaceTex(256, 128, { seed: 23, scale: 3, oct: 4, stops: [[0, [80, 74, 68]], [1, [150, 140, 130]]], craters: 25, craterMax: 0.07 }),
  io: () => { const c = surfaceTex(512, 256, { seed: 24, scale: 3, oct: 5, contrast: 2.4, stops: [[0, [236, 214, 96]], [0.4, [244, 232, 150]], [0.7, [214, 138, 48]], [1, [252, 246, 225]]] });
    addSpots(c, 26, 0.02, 'rgba(40,24,16,0.85)', 24); return c; },
  europa: () => { const c = surfaceTex(512, 256, { seed: 25, scale: 2, oct: 4, contrast: 1.8, stops: [[0, [178, 138, 102]], [0.45, [226, 214, 198]], [1, [246, 242, 236]]] });
    addCracks(c, 70, 'rgba(130,80,50,0.45)', 1.4, 25); return c; },
  ganymede: () => surfaceTex(512, 256, { seed: 26, scale: 2.6, oct: 6, contrast: 2.4, stops: [[0, [78, 68, 58]], [0.5, [138, 124, 108]], [1, [196, 188, 176]]], craters: 120, craterMax: 0.04 }),
  callisto: () => surfaceTex(512, 256, { seed: 27, scale: 3, oct: 6, contrast: 2, stops: [[0, [36, 32, 28]], [0.55, [78, 70, 62]], [1, [128, 118, 106]]], craters: 300, craterMax: 0.035 }),
  titan: () => surfaceTex(512, 256, { seed: 28, scale: 1.6, oct: 4, contrast: 1.5, stops: [[0, [184, 122, 38]], [0.5, [220, 158, 58]], [1, [240, 190, 98]]] }),
  enceladus: () => { const c = surfaceTex(256, 128, { seed: 29, scale: 2, oct: 4, stops: [[0, [206, 218, 230]], [1, [252, 254, 255]]], craters: 40, craterMax: 0.05 });
    addCracks(c, 14, 'rgba(110,165,210,0.55)', 1.2, 29); return c; },
  triton: () => surfaceTex(512, 256, { seed: 30, scale: 2.4, oct: 5, contrast: 2, stops: [[0, [188, 164, 156]], [0.5, [226, 206, 196]], [1, [247, 234, 228]]], cap: { lat: 1.1, soft: 0.2, color: [250, 238, 238] } }),
  miranda: () => surfaceTex(256, 128, { seed: 31, scale: 3.4, oct: 6, contrast: 3, stops: [[0, [88, 90, 94]], [0.5, [150, 152, 156]], [1, [208, 210, 214]]], craters: 60, craterMax: 0.05 }),
  titania: () => surfaceTex(256, 128, { seed: 32, scale: 2.4, oct: 5, stops: [[0, [80, 76, 72]], [1, [168, 158, 150]]], craters: 120, craterMax: 0.04 }),
  oberon: () => surfaceTex(256, 128, { seed: 33, scale: 2.4, oct: 5, stops: [[0, [72, 68, 64]], [1, [154, 146, 138]]], craters: 150, craterMax: 0.04 }),
  charon: () => surfaceTex(256, 128, { seed: 34, scale: 2.4, oct: 5, stops: [[0, [96, 94, 92]], [0.5, [150, 148, 146]], [1, [190, 188, 186]]], craters: 80, craterMax: 0.04, cap: { lat: 1.12, soft: 0.1, color: [150, 80, 60] } })
};

function ringCanvas(kind) {
  const w = 1024, c = makeCanvas(w, 4), ctx = c.getContext('2d'), img = ctx.createImageData(w, 4), d = img.data;
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const band = (u, a, b, s) => ss(a - s, a + s, u) * (1 - ss(b - s, b + s, u));
  for (let x = 0; x < w; x++) {
    const u = x / (w - 1);
    let a, r, g, b;
    if (kind === 'saturn') {
      a = 0.22 * band(u, 0.0, 0.27, 0.01) + 0.93 * band(u, 0.27, 0.67, 0.008) + 0.06 * band(u, 0.67, 0.75, 0.01)
        + 0.76 * band(u, 0.75, 0.975, 0.008) * (1 - 0.85 * band(u, 0.915, 0.925, 0.003)) + 0.5 * band(u, 0.985, 0.995, 0.003);
      a *= 0.78 + 0.35 * noise3(u * 150, 1.3, 0.7);
      const tone = band(u, 0.27, 0.67, 0.05);
      r = lerp(165, 232, tone); g = lerp(148, 212, tone); b = lerp(120, 178, tone);
    } else {
      a = 0; for (const p of [0.18, 0.28, 0.36, 0.46, 0.54, 0.62, 0.9]) a += 0.55 * band(u, p - 0.006, p + 0.006, 0.003);
      r = 150; g = 170; b = 180;
    }
    a = clamp(a, 0, 1);
    for (let y = 0; y < 4; y++) { const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a * 255; }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function glowCanvas() {
  const c = makeCanvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return c;
}
function dotCanvas() {
  const c = makeCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}
function reticleCanvas() {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  g.strokeStyle = '#6fd8ff'; g.lineWidth = 4; g.lineCap = 'round';
  const m = 14, L = 26;
  g.beginPath();
  g.moveTo(m, m + L); g.lineTo(m, m); g.lineTo(m + L, m);
  g.moveTo(128 - m - L, m); g.lineTo(128 - m, m); g.lineTo(128 - m, m + L);
  g.moveTo(128 - m, 128 - m - L); g.lineTo(128 - m, 128 - m); g.lineTo(128 - m - L, 128 - m);
  g.moveTo(m + L, 128 - m); g.lineTo(m, 128 - m); g.lineTo(m, 128 - m - L);
  g.stroke();
  g.globalAlpha = 0.35; g.lineWidth = 2; g.beginPath(); g.arc(64, 64, 46, 0, TAU); g.stroke();
  return c;
}

/* ======================================================================
   4. RENDERER, SCENE, SHADERS
   ====================================================================== */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const PR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(PR);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x02030a, 1);
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 9000);
const root = new THREE.Group(); scene.add(root);
const cometRoot = new THREE.Group(); scene.add(cometRoot);
const tailRoot = new THREE.Group(); scene.add(tailRoot);

const sunLight = new THREE.PointLight(0xfff0dc, 1.55, 0, 0); scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x2a3a5c, 0.5));

const SPH_HI = new THREE.SphereGeometry(1, 64, 48);
const SPH_LO = new THREE.SphereGeometry(1, 32, 24);
const glowTex = new THREE.CanvasTexture(glowCanvas());
const dotTex = new THREE.CanvasTexture(dotCanvas());

const tv1 = new THREE.Vector3(), tv2 = new THREE.Vector3(), tv3 = new THREE.Vector3();

/* --- Sun surface --- */
const SUN_VS = `
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
void main(){
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SUN_FS = `
uniform float uTime;
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0.0,0.0,0.0)), hash(i + vec3(1.0,0.0,0.0)), f.x),
                 mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x),
                 mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float v = 0.0; float a = 0.5; for(int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }
void main(){
  vec3 p = normalize(vPos) * 2.2;
  float t = uTime * 0.06;
  float n1 = fbm(p + vec3(t, -t * 0.6, t * 0.8));
  float n2 = fbm(p * 2.4 + n1 * 1.6 - vec3(t * 1.4));
  float heat = clamp(n1 * 0.55 + n2 * 0.65, 0.0, 1.0);
  heat += (noise(p * 9.0 + t * 3.0) - 0.5) * 0.12;
  float spots = smoothstep(0.6, 0.76, fbm(p * 1.3 + vec3(5.0, t * 0.3, 2.0)));
  vec3 c1 = vec3(0.78, 0.16, 0.02), c2 = vec3(1.0, 0.55, 0.08), c3 = vec3(1.0, 0.86, 0.42), c4 = vec3(1.0, 0.97, 0.82);
  vec3 col = mix(c1, c2, smoothstep(0.25, 0.55, heat));
  col = mix(col, c3, smoothstep(0.5, 0.78, heat));
  col = mix(col, c4, smoothstep(0.75, 0.95, heat));
  col *= 1.0 - spots * 0.45;
  float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  col *= 0.55 + 0.6 * pow(mu, 0.6);
  col = mix(col, c1 * 0.9, pow(1.0 - mu, 3.0) * 0.5);
  gl_FragColor = vec4(col * 1.15, 1.0);
}`;

/* --- Atmosphere / selection glow (sun is at the origin) --- */
const ATMO_VS = `
varying vec3 vN; varying vec3 vW;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ATMO_FS = `
uniform vec3 uColor; uniform float uPower; uniform float uIntensity; uniform float uInner; uniform float uBack; uniform float uLit;
varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float d = dot(n, v);
  float f;
  if (uBack > 0.5) { f = pow(clamp(-d / uInner, 0.0, 1.0), uPower); }
  else { f = pow(clamp(1.0 - abs(d), 0.0, 1.0), uPower); }
  vec3 l = normalize(-vW);
  float lit = clamp(dot(n, l) * 0.85 + 0.35, 0.0, 1.0);
  lit = mix(1.0, lit, uLit);
  gl_FragColor = vec4(uColor * f * uIntensity * lit, 1.0);
}`;
function makeAtmo(color, R, power, intensity, back, lit) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uIntensity: { value: intensity },
      uInner: { value: Math.sqrt(Math.max(0.0001, 1 - 1 / (R * R))) }, uBack: { value: back ? 1 : 0 }, uLit: { value: lit == null ? 1 : lit }
    },
    vertexShader: ATMO_VS, fragmentShader: ATMO_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: back ? THREE.BackSide : THREE.FrontSide
  });
  const m = new THREE.Mesh(SPH_HI, mat); m.scale.setScalar(R); m.frustumCulled = false; m.renderOrder = 2;
  return m;
}
const ATMO = {
  earth: [{ c: 0x5aa8ff, R: 1.10, p: 1.5, i: 1.25, back: 1 }, { c: 0x6ab8ff, R: 1.018, p: 3.0, i: 0.85, back: 0 }],
  venus: [{ c: 0xffd08a, R: 1.09, p: 1.4, i: 1.1, back: 1 }, { c: 0xffe0a8, R: 1.015, p: 2.6, i: 0.7, back: 0 }],
  mars: [{ c: 0xff9a6a, R: 1.06, p: 2.0, i: 0.55, back: 1 }],
  jupiter: [{ c: 0xe8c9a0, R: 1.05, p: 2.0, i: 0.4, back: 1 }],
  saturn: [{ c: 0xf3e2b0, R: 1.05, p: 2.0, i: 0.4, back: 1 }],
  uranus: [{ c: 0x9be7f0, R: 1.08, p: 1.6, i: 0.8, back: 1 }, { c: 0xaef0f6, R: 1.015, p: 3, i: 0.5, back: 0 }],
  neptune: [{ c: 0x4d7dff, R: 1.08, p: 1.6, i: 0.9, back: 1 }, { c: 0x6a95ff, R: 1.015, p: 3, i: 0.5, back: 0 }],
  titan: [{ c: 0xffb04a, R: 1.13, p: 1.4, i: 1.0, back: 1 }],
  pluto: [{ c: 0x8fb4ff, R: 1.06, p: 2, i: 0.35, back: 1 }]
};

/* --- Rings (with planet shadow cast onto the ring) --- */
const RING_VS = `
uniform float uInner; uniform float uOuter;
varying float vR; varying vec3 vW; varying vec3 vNW;
void main(){
  vR = (length(position.xy) - uInner) / (uOuter - uInner);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vNW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RING_FS = `
uniform sampler2D uMap; uniform vec3 uCenter; uniform float uRadius; uniform float uBright;
varying float vR; varying vec3 vW; varying vec3 vNW;
void main(){
  vec4 t = texture2D(uMap, vec2(clamp(vR, 0.0, 1.0), 0.5));
  if (t.a < 0.02) discard;
  vec3 toSun = normalize(-vW);
  vec3 oc = uCenter - vW;
  float tt = dot(oc, toSun);
  float shade = 1.0;
  if (tt > 0.0) { float d = length(oc - toSun * tt); shade = smoothstep(uRadius * 0.985, uRadius * 1.03, d); }
  float side = 0.55 + 0.45 * clamp(abs(dot(vNW, toSun)) * 2.2, 0.0, 1.0);
  float light = mix(0.06, 1.0, shade) * side;
  gl_FragColor = vec4(t.rgb * light * uBright, t.a);
}`;
function makeRing(inner, outer, cv, bright) {
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uInner: { value: inner }, uOuter: { value: outer }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1 }, uBright: { value: bright } },
    vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, side: THREE.DoubleSide, depthWrite: false
  });
  const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 192, 1), mat);
  m.rotation.x = -Math.PI / 2; m.frustumCulled = false;
  return m;
}

/* --- Comet tail --- */
const TAIL_GEO = new THREE.ConeGeometry(1, 1, 24, 1, true); TAIL_GEO.translate(0, -0.5, 0);
function makeTail(color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV;
      void main(){ vT = clamp(-position.y, 0.0, 1.0); vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vT; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - vT, 1.4); float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
        gl_FragColor = vec4(uColor * f * e * uOpacity * 1.5, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(TAIL_GEO, mat); m.frustumCulled = false;
  return m;
}

/* --- Selection shell + reticle --- */
const selShell = makeAtmo(0x4cd1ff, 1.035, 2.2, 1.1, false, 0); selShell.visible = false;
const reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(reticleCanvas()), transparent: true, depthTest: false, depthWrite: false }));
reticle.renderOrder = 10; reticle.visible = false; reticle.frustumCulled = false; scene.add(reticle);

/* ======================================================================
   5. BODIES
   ====================================================================== */
const bodies = [];
const byId = {};
const labelsEl = $('#labels');

class Body {
  constructor(def) {
    this.def = def; this.id = def.id; this.name = def.name; this.cat = def.cat;
    this.parent = null; this.moons = []; this.radius = 1;
    this.holder = new THREE.Group();
    this.scaleGroup = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.holder.add(this.scaleGroup); this.scaleGroup.add(this.tiltGroup);
    this.tiltGroup.rotation.z = (def.tilt || 0) * DEG;
    this.M0 = rnd() * TAU; this.M = this.M0;
    this.a = 1; this.b = 1; this.e = def.e || 0;
    this.spinPhase = rnd() * TAU; this.spinRate = 0; this.sync = false;
    this.surface = null; this.clouds = null; this.ringMesh = null; this.orbitLine = null; this.labelEl = null;
    this.Pvis = 1; this.ringOuter = def.ringOuter || 0;
  }
  getPos(out) { return out.setFromMatrixPosition(this.holder.matrixWorld); }
  isActive() { const T = state.toggles; return this.cat === 'moon' ? T.moons : this.cat === 'comet' ? T.comets : true; }
}

function texOf(cv) { const t = new THREE.CanvasTexture(cv); t.anisotropy = ANISO; return t; }

function buildSun(b) {
  const mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SUN_VS, fragmentShader: SUN_FS });
  const mesh = new THREE.Mesh(SPH_HI, mat);
  b.tiltGroup.add(mesh); b.surface = mesh; b.sunMat = mat;
  const mk = (color, op) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
  b.glow1 = mk(0xffa640, 0.5); b.glow2 = mk(0xff6a1a, 0.2);
  b.holder.add(b.glow1, b.glow2);
}

function buildComet(b) {
  const geo = new THREE.IcosahedronGeometry(1, 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 0.75 + 0.5 * noise3(x * 1.8 + 3, y * 1.8, z * 1.8);
    p.setXYZ(i, x * n, y * n * 0.85, z * n * 1.1);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6b625a, roughness: 1, flatShading: true }));
  b.tiltGroup.add(mesh); b.surface = mesh;
  b.coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xaee8ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  b.holder.add(b.coma);
  b.ion = makeTail(0x6cc8ff); b.dust = makeTail(0xffe2b0);
  tailRoot.add(b.ion, b.dust);
  b.prev = new THREE.Vector3(); b.dustDir = new THREE.Vector3(1, 0, 0);
}

function buildPlanetLike(b) {
  const d = b.def, id = d.id;
  const small = d.cat === 'moon' && d.rEdu < 0.45;
  let mat;
  if (id === 'earth') {
    const [cc, rc] = earthCanvases();
    mat = new THREE.MeshStandardMaterial({ map: texOf(cc), roughnessMap: texOf(rc), roughness: 1, metalness: 0 });
  } else {
    mat = new THREE.MeshStandardMaterial({ map: texOf(TEX[id]()), roughness: 0.95, metalness: 0 });
  }
  const mesh = new THREE.Mesh(small ? SPH_LO : SPH_HI, mat);
  if (d.ell) mesh.scale.set(d.ell[0], d.ell[1], d.ell[2]);
  b.tiltGroup.add(mesh); b.surface = mesh;

  if (id === 'earth') {
    const cm = new THREE.Mesh(SPH_HI, new THREE.MeshStandardMaterial({ map: texOf(cloudCanvas()), transparent: true, depthWrite: false, roughness: 1, metalness: 0 }));
    cm.scale.setScalar(1.012); b.tiltGroup.add(cm); b.clouds = cm;
  }
  (ATMO[id] || []).forEach(a => b.tiltGroup.add(makeAtmo(a.c, a.R, a.p, a.i, a.back)));

  if (id === 'saturn') {
    b.ringMesh = makeRing(1.24, 2.3, ringCanvas('saturn'), 1.0); b.tiltGroup.add(b.ringMesh);
  } else if (id === 'uranus') {
    b.ringMesh = makeRing(1.55, 2.05, ringCanvas('uranus'), 0.7); b.tiltGroup.add(b.ringMesh);
  }
}

function makeLabel(b) {
  const el = document.createElement('div');
  el.className = 'lbl lbl-' + b.cat; el.textContent = b.name;
  el.addEventListener('click', e => { e.stopPropagation(); selectTarget(b, { focus: true }); });
  labelsEl.appendChild(el); b.labelEl = el; el._on = false;
}

function addOrbitLine(b, parentGroup) {
  let mat, base;
  if (b.cat === 'comet') { base = 0.7; mat = new THREE.LineDashedMaterial({ color: 0x5ff2e0, dashSize: 6, gapSize: 5, transparent: true, opacity: base }); }
  else if (b.cat === 'moon') { base = 0.22; mat = new THREE.LineBasicMaterial({ color: 0x9fb4d0, transparent: true, opacity: base }); }
  else if (b.cat === 'dwarf') { base = 0.3; mat = new THREE.LineBasicMaterial({ color: 0xb48cff, transparent: true, opacity: base }); }
  else { base = 0.3; mat = new THREE.LineBasicMaterial({ color: 0x6fa8ff, transparent: true, opacity: base }); }
  const line = new THREE.Line(new THREE.BufferGeometry(), mat);
  line.frustumCulled = false; line.userData.base = base;
  parentGroup.add(line); b.orbitLine = line;
}

function createBody(def, parent) {
  const b = new Body(def); bodies.push(b); byId[def.id] = b;
  if (def.cat === 'star') {
    root.add(b.holder);
  } else if (def.cat === 'moon') {
    b.parent = parent; parent.moons.push(b);
    b.planeTilt = new THREE.Group(); b.planeIncl = new THREE.Group();
    b.planeTilt.rotation.z = def.followTilt ? (parent.def.tilt || 0) * DEG : 0;
    b.planeIncl.rotation.x = (def.incl || 0) * DEG;
    parent.holder.add(b.planeTilt); b.planeTilt.add(b.planeIncl); b.planeIncl.add(b.holder);
    addOrbitLine(b, b.planeIncl);
  } else {
    b.nodeG = new THREE.Group(); b.inclG = new THREE.Group(); b.argG = new THREE.Group();
    b.nodeG.rotation.y = def.node * DEG; b.inclG.rotation.x = def.incl * DEG; b.argG.rotation.y = def.peri * DEG;
    b.nodeG.add(b.inclG); b.inclG.add(b.argG); b.argG.add(b.holder);
    (def.cat === 'comet' ? cometRoot : root).add(b.nodeG);
    addOrbitLine(b, b.argG);
  }

  if (def.cat === 'star') buildSun(b);
  else if (def.cat === 'comet') buildComet(b);
  else buildPlanetLike(b);

  if (def.cat === 'moon') b.Pvis = Math.max(2.5, 3 * Math.pow(def.periodDays, 0.45));
  else if (def.cat !== 'star') b.Pvis = clamp(12 * Math.pow(def.periodDays / 88, 0.55), 2.5, 700);
  b.sync = def.cat === 'moon';
  b.spinRate = def.cat === 'star' ? 0.08 : def.rotH ? clamp(0.35 * Math.pow(24 / Math.abs(def.rotH), 0.45), 0.01, 1.1) : 0.3;
  makeLabel(b);
  return b;
}

/* ======================================================================
   6. BELTS, KUIPER, OORT, DUST, STARS
   ====================================================================== */
const belt = { items: [], meshes: [], groups: [], local: null, sizeFactor: 1, root: new THREE.Group() };
const kuiper = { n: 0, au: null, ang: null, yf: null, group: new THREE.Group(), points: null };
const oort = { group: new THREE.Group(), points: null, wire: null };
const dust = { group: new THREE.Group(), points: null };
scene.add(belt.root, kuiper.group, oort.group, dust.group);
const BELT_LAYERS = 3, BELT_AU0 = 2.1, BELT_SPAN = 1.3;

function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 0.68 + 0.64 * noise3(x * 1.6 + seed * 5, y * 1.6 + seed, z * 1.6);
    p.setXYZ(i, x * n, y * n, z * n);
  }
  g.computeVertexNormals();
  return g;
}

function buildBelt() {
  const geos = [rockGeo(1), rockGeo(2), rockGeo(3)];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true });
  const N = 2700, gaps = [[2.48, 2.52], [2.8, 2.84], [2.93, 2.97], [3.25, 3.29]];
  const counts = []; for (let l = 0; l < BELT_LAYERS; l++) counts.push([0, 0, 0]);
  for (let i = 0; i < N; i++) {
    let au;
    do { au = 2.15 + (rnd() + rnd() + rnd()) / 3 * 1.2; } while (gaps.some(g => au > g[0] && au < g[1]));
    const layer = clamp(Math.floor((au - BELT_AU0) / BELT_SPAN * BELT_LAYERS), 0, BELT_LAYERS - 1), shape = Math.floor(rnd() * 3);
    const it = {
      au, ang: rnd() * TAU, yf: clamp(randn() * 0.06, -0.14, 0.14), s: 0.12 + Math.pow(rnd(), 3) * 0.55, layer, shape, idx: counts[layer][shape]++,
      sx: 0.7 + rnd() * 0.6, sy: 0.7 + rnd() * 0.6, sz: 0.7 + rnd() * 0.6, rx: rnd() * TAU, ry: rnd() * TAU, rz: rnd() * TAU, rot: 4 + rnd() * 20,
      name: '2026 ' + String.fromCharCode(65 + Math.floor(rnd() * 26)) + String.fromCharCode(65 + Math.floor(rnd() * 26)) + Math.floor(1 + rnd() * 99)
    };
    belt.items.push(it);
  }
  const col = new THREE.Color();
  for (let l = 0; l < BELT_LAYERS; l++) {
    const g = new THREE.Group(); belt.root.add(g); belt.groups.push(g); belt.meshes.push([]);
    for (let s = 0; s < 3; s++) {
      const m = new THREE.InstancedMesh(geos[s], mat, Math.max(1, counts[l][s]));
      m.count = counts[l][s]; m.frustumCulled = false; g.add(m); belt.meshes[l].push(m);
    }
  }
  belt.items.forEach(it => {
    col.setHSL(0.07 + rnd() * 0.05, 0.08 + rnd() * 0.18, 0.26 + rnd() * 0.32);
    belt.meshes[it.layer][it.shape].setColorAt(it.idx, col);
    it.mesh = belt.meshes[it.layer][it.shape]; it.group = belt.groups[it.layer];
  });
  belt.local = new Float32Array(N * 3);
}
function rebuildBelt() {
  const edu = state.scale === 'edu', sf = edu ? 1 : 0.5, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  belt.sizeFactor = sf;
  belt.items.forEach((it, i) => {
    const r = distOf(it.au);
    p.set(r * Math.cos(it.ang), it.yf * r, -r * Math.sin(it.ang));
    belt.local[i * 3] = p.x; belt.local[i * 3 + 1] = p.y; belt.local[i * 3 + 2] = p.z;
    q.setFromEuler(e.set(it.rx, it.ry, it.rz));
    s.set(it.s * sf * it.sx, it.s * sf * it.sy, it.s * sf * it.sz);
    m4.compose(p, q, s);
    it.mesh.setMatrixAt(it.idx, m4);
  });
  belt.meshes.forEach(arr => arr.forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }));
}
function beltWorld(i, out) {
  const L = belt.local;
  return out.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(belt.items[i].group.matrixWorld);
}

function buildKuiper() {
  const n = 4500; kuiper.n = n;
  kuiper.au = new Float32Array(n); kuiper.ang = new Float32Array(n); kuiper.yf = new Float32Array(n);
  const col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const k = rnd();
    kuiper.au[i] = k < 0.2 ? 39.4 + randn() * 0.8 : k < 0.8 ? 42 + rnd() * 6 : 30 + rnd() * 30;
    kuiper.ang[i] = rnd() * TAU; kuiper.yf[i] = randn() * 0.1;
    c.setHSL(0.58 + rnd() * 0.08, 0.35, 0.55 + rnd() * 0.3); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  kuiper.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, map: dotTex, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  kuiper.points.frustumCulled = false; kuiper.group.add(kuiper.points);
}
function rebuildKuiper() {
  const pos = kuiper.points.geometry.attributes.position.array;
  for (let i = 0; i < kuiper.n; i++) {
    const r = distOf(kuiper.au[i]);
    pos[i * 3] = r * Math.cos(kuiper.ang[i]); pos[i * 3 + 1] = kuiper.yf[i] * r; pos[i * 3 + 2] = -r * Math.sin(kuiper.ang[i]);
  }
  kuiper.points.geometry.attributes.position.needsUpdate = true;
  kuiper.points.material.size = state.scale === 'edu' ? 2.2 : 28;
}

function buildOort() {
  const n = 7000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u), r = 0.72 + 0.28 * Math.sqrt(rnd());
    pos[i * 3] = r * s * Math.cos(th); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(th);
    c.setHSL(0.6 + rnd() * 0.05, 0.3, 0.5 + rnd() * 0.3); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  oort.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 5, map: dotTex, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  oort.points.frustumCulled = false;
  oort.wire = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), new THREE.MeshBasicMaterial({ color: 0x4a78b8, wireframe: true, transparent: true, opacity: 0.05, depthWrite: false }));
  oort.wire.frustumCulled = false;
  oort.group.add(oort.points, oort.wire);
}

function buildDust() {
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u), r = Math.cbrt(rnd()) * 650;
    pos[i * 3] = r * s * Math.cos(th); pos[i * 3 + 1] = r * u * 0.6; pos[i * 3 + 2] = r * s * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dust.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.9, map: dotTex, color: 0xb8c8e8, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.points.frustumCulled = false; dust.group.add(dust.points);
}

const starfield = new THREE.Group(); scene.add(starfield);
function buildStars() {
  const mk = (n, size, fn, opacity) => {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) fn(i, pos, col);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: size * PR, map: dotTex, vertexColors: true, transparent: true, opacity, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; pts.renderOrder = -10; starfield.add(pts);
  };
  const dir = (i, pos) => { const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u); pos[i * 3] = s * Math.cos(th); pos[i * 3 + 1] = u; pos[i * 3 + 2] = s * Math.sin(th); };
  const tint = () => { const t = rnd(); return t < 0.15 ? [0.7, 0.8, 1] : t < 0.7 ? [1, 1, 1] : t < 0.9 ? [1, 0.93, 0.78] : [1, 0.75, 0.55]; };
  mk(7000, 1.7, (i, pos, col) => { dir(i, pos); const t = tint(), b = 0.25 + 0.75 * Math.pow(rnd(), 2.2); col[i * 3] = t[0] * b; col[i * 3 + 1] = t[1] * b; col[i * 3 + 2] = t[2] * b; }, 1);
  mk(700, 3.2, (i, pos, col) => { dir(i, pos); const t = tint(), b = 0.6 + 0.4 * rnd(); col[i * 3] = t[0] * b; col[i * 3 + 1] = t[1] * b; col[i * 3 + 2] = t[2] * b; }, 1);
  const n = new THREE.Vector3(0.35, 0.85, 0.4).normalize(), e1 = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize(), e2 = new THREE.Vector3().crossVectors(n, e1);
  mk(6000, 4.2, (i, pos, col) => {
    const a = rnd() * TAU, off = randn() * 0.13, v = new THREE.Vector3().addScaledVector(e1, Math.cos(a)).addScaledVector(e2, Math.sin(a)).addScaledVector(n, off).normalize();
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    const b = 0.05 + 0.1 * rnd(); col[i * 3] = 0.55 * b * 2; col[i * 3 + 1] = 0.6 * b * 2; col[i * 3 + 2] = 1.0 * b * 2;
  }, 0.5);
}

/* ======================================================================
   7. SCALE SWITCHING
   ====================================================================== */
const ORIGIN = { cat: 'origin', radius: 1, getPos: o => o.set(0, 0, 0) };
const cam = {
  target: new THREE.Vector3(), theta: 0.7, phi: 1.12, radius: 560,
  gTheta: 0.7, gPhi: 1.12, gRadius: 560, anim: null, following: null, minR: 0.2, maxR: 3200
};
const overviewRadius = () => (state.scale === 'edu' ? 560 : 6800);

function rebuildOrbitLine(b) {
  const N = b.cat === 'moon' ? 96 : b.cat === 'comet' ? 400 : 288, pos = new Float32Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) {
    const E = i / N * TAU;
    if (b.cat === 'moon') { pos[i * 3] = b.a * Math.cos(E); pos[i * 3 + 2] = -b.a * Math.sin(E); }
    else { pos[i * 3] = b.a * (Math.cos(E) - b.e); pos[i * 3 + 2] = -b.b * Math.sin(E); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  b.orbitLine.geometry.dispose(); b.orbitLine.geometry = g;
  if (b.cat === 'comet') {
    b.orbitLine.computeLineDistances();
    const edu = state.scale === 'edu'; b.orbitLine.material.dashSize = edu ? 6 : 70; b.orbitLine.material.gapSize = edu ? 5 : 55;
  }
}

function applyScale() {
  const edu = state.scale === 'edu';
  for (const b of bodies) {
    const d = b.def;
    b.radius = b.cat === 'star' ? (edu ? 12 : 20) : b.cat === 'comet' ? (edu ? 0.55 : 0.22) : edu ? d.rEdu : relRadius(d);
    b.scaleGroup.scale.setScalar(b.radius);
    if (b.cat === 'moon') { b.a = b.b = b.parent.radius * d.k; b.e = 0; }
    else if (b.cat === 'comet') {
      const q = edu ? eduDist(d.q) : d.q * REL_AU, Q = edu ? eduDist(d.Q) : Math.min(d.Q, 150) * REL_AU;
      b.a = (q + Q) / 2; b.e = (Q - q) / (Q + q); b.b = b.a * Math.sqrt(1 - b.e * b.e);
    } else if (b.cat !== 'star') { b.a = distOf(d.aAU); b.e = d.e; b.b = b.a * Math.sqrt(1 - b.e * b.e); }
    if (b.orbitLine) rebuildOrbitLine(b);
    if (b.cat === 'star') { b.glow1.scale.setScalar(b.radius * 4.6); b.glow2.scale.setScalar(b.radius * 10); }
  }
  rebuildBelt(); rebuildKuiper();
  oort.group.scale.setScalar(edu ? 1100 : 18000); oort.points.material.size = edu ? 5 : 80;
  dust.group.scale.setScalar(edu ? 1 : 8); dust.points.material.size = edu ? 0.9 : 7;
  const far = edu ? 9000 : 90000;
  camera.far = far; starfield.scale.setScalar(far * 0.8);
  cam.maxR = edu ? 3200 : 42000;
}

function setScale(mode) {
  if (state.scale === mode) return;
  state.scale = mode;
  $$('#scale-seg button').forEach(b => b.classList.toggle('active', b.dataset.scale === mode));
  applyScale();
  scene.updateMatrixWorld(true);
  if (state.selected) focusOn(state.selected); else resetCamera(true);
  toast(mode === 'edu' ? 'Educational scale: worlds enlarged, order preserved' : 'Relative scale: true size and distance ratios');
}

/* ======================================================================
   8. CAMERA + INPUT
   ====================================================================== */
function focusDistance(t) {
  if (t.cat === 'comet') return state.scale === 'edu' ? 16 : 40;
  if (t.cat === 'asteroid') return Math.max(t.radius * 7, 2.5);
  let r = t.radius; if (t.ringOuter) r *= t.ringOuter * 0.95;
  return Math.max(r * 3.2, r + 0.6);
}
function focusOn(t, endR) {
  t.getPos(tv1);
  const dist = camera.position.distanceTo(tv1);
  cam.anim = {
    t: 0, dur: clamp(0.9 + Math.log10(1 + dist / 5) * 0.6, 1.0, 2.4), start: cam.target.clone(), startR: cam.radius,
    endR: endR || focusDistance(t), obj: t
  };
  cam.following = null;
}
function resetCamera(silent) {
  deselect(true);
  cam.gTheta = 0.7; cam.gPhi = 1.12;
  focusOn(ORIGIN, overviewRadius());
  if (!silent) toast('Camera reset');
}
function setCameraMode(mode) {
  state.cameraMode = mode;
  $$('#mode-seg button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'free') { cam.following = null; toast('Free camera: stays where you leave it'); }
  else {
    toast('Follow mode: camera travels with the selected object');
    if (state.selected) focusOn(state.selected);
  }
}
function leaveFollow() { if (state.cameraMode === 'follow' && (cam.following || (cam.anim && cam.anim.obj !== ORIGIN))) { cam.following = null; state.cameraMode = 'free'; $$('#mode-seg button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'free')); toast('Free camera'); } }

function zoomBy(f) {
  if (cam.anim) cam.anim.endR = clamp(cam.anim.endR * f, 0.05, cam.maxR);
  else cam.gRadius *= f;
}

function panCamera(dx, dy) {
  leaveFollow(); cam.anim = null;
  const k = 2 * cam.radius * Math.tan(camera.fov * DEG / 2) / window.innerHeight;
  tv1.set(1, 0, 0).applyQuaternion(camera.quaternion); tv2.set(0, 1, 0).applyQuaternion(camera.quaternion);
  cam.target.addScaledVector(tv1, -dx * k).addScaledVector(tv2, dy * k);
}

function updateCamera(dt) {
  const s = 1 - Math.exp(-dt * 9);
  if (cam.anim) {
    const A = cam.anim; A.t += dt / A.dur;
    const k = Math.min(A.t, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    A.obj.getPos(tv1);
    cam.target.lerpVectors(A.start, tv1, e);
    cam.radius = Math.exp(lerp(Math.log(A.startR), Math.log(A.endR), e));
    cam.gRadius = cam.radius;
    if (A.t >= 1) { cam.anim = null; if (A.obj !== ORIGIN && state.cameraMode === 'follow') cam.following = A.obj; }
  } else if (cam.following) {
    cam.following.getPos(cam.target);
  }
  // held keys
  if (keys.size) {
    if (keys.has('ArrowLeft')) cam.gTheta += 1.5 * dt;
    if (keys.has('ArrowRight')) cam.gTheta -= 1.5 * dt;
    if (keys.has('ArrowUp')) cam.gPhi -= 1.2 * dt;
    if (keys.has('ArrowDown')) cam.gPhi += 1.2 * dt;
    if (keys.has('w') || keys.has('+') || keys.has('=')) zoomBy(Math.exp(-1.3 * dt));
    if (keys.has('s') || keys.has('-') || keys.has('_')) zoomBy(Math.exp(1.3 * dt));
    if (keys.has('a')) panCamera(-260 * dt, 0);
    if (keys.has('d')) panCamera(260 * dt, 0);
  }
  cam.minR = cam.following ? Math.max(0.05, cam.following.radius * 1.2) : 0.2;
  cam.gPhi = clamp(cam.gPhi, 0.05, Math.PI - 0.05);
  cam.gRadius = clamp(cam.gRadius, cam.minR, cam.maxR);
  cam.theta += (cam.gTheta - cam.theta) * s;
  cam.phi += (cam.gPhi - cam.phi) * s;
  if (!cam.anim) cam.radius += (cam.gRadius - cam.radius) * s;

  const sp = Math.sin(cam.phi);
  camera.position.set(cam.target.x + cam.radius * sp * Math.sin(cam.theta), cam.target.y + cam.radius * Math.cos(cam.phi), cam.target.z + cam.radius * sp * Math.cos(cam.theta));
  camera.lookAt(cam.target);
  camera.near = clamp(cam.radius * 0.01, 0.01, 25);
  camera.updateProjectionMatrix();
}

const keys = new Set();
const ptrs = new Map();
let pinch = null, pinched = false;
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button, pan: e.shiftKey || e.ctrlKey || e.metaKey });
  hideSearch();
  if (ptrs.size === 2) { const [a, b] = Array.from(ptrs.values()); pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; pinched = true; }
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) {
    if (p.button === 2 || p.button === 1 || p.pan) panCamera(dx, dy);
    else { cam.gTheta -= dx * 0.0055; cam.gPhi -= dy * 0.0055; }
  } else if (ptrs.size === 2 && pinch) {
    const [a, b] = Array.from(ptrs.values()), d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (d > 5 && pinch.d > 5) zoomBy(pinch.d / d);
    panCamera(mx - pinch.mx, my - pinch.my);
    pinch.d = d; pinch.mx = mx; pinch.my = my;
  }
});
function endPointer(e, allowClick) {
  const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
  if (p && allowClick && ptrs.size === 0 && !pinched) {
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6 && performance.now() - p.t < 600 && p.button === 0) handleClick(e.clientX, e.clientY);
  }
  if (ptrs.size === 0) { pinched = false; pinch = null; }
}
canvas.addEventListener('pointerup', e => endPointer(e, true));
canvas.addEventListener('pointercancel', e => endPointer(e, false));
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.0015));
}, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { if (e.key === 'Escape') { e.target.blur(); hideSearch(); } return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' && tag === 'BUTTON') e.target.blur();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd', '+', '=', '-', '_'].includes(k)) { keys.add(k); e.preventDefault(); return; }
  if (k === ' ') { e.preventDefault(); setPlaying(!state.playing); }
  else if (k === 'r') resetCamera();
  else if (k === 'f') focusSelected();
  else if (k === '/') { e.preventDefault(); $('#search-input').focus(); }
  else if (k === 'Escape') { closeModals(); deselect(); }
});
window.addEventListener('keyup', e => { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
window.addEventListener('blur', () => keys.clear());

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

/* ======================================================================
   9. PICKING + SELECTION
   ====================================================================== */
function asteroidTarget(i) {
  const a = belt.items[i], au = a.au, diam = Math.round(Math.pow(a.s / 0.12, 2.2) * 3);
  return {
    cat: 'asteroid', id: 'ast-' + i, name: 'Asteroid ' + a.name, labelEl: null, scaleGroup: null,
    get radius() { return a.s * belt.sizeFactor; },
    getPos(out) { return beltWorld(i, out); },
    isActive() { return state.toggles.asteroids; },
    def: {
      color: '#b8a58f', type: 'Main-belt asteroid (procedurally generated)', diamKm: diam, aAU: au, periodDays: 365.25 * Math.pow(au, 1.5),
      rotH: a.rot, moons: 0, g: Number((2.8e-4 * diam).toPrecision(2)), massKg: null, temp: '≈ ' + Math.round(278 / Math.sqrt(au) - 273) + ' °C',
      desc: 'A rocky fragment orbiting in the main belt between Mars and Jupiter. Real asteroids are leftover building blocks from the birth of the planets.',
      facts: ['The belt holds millions of asteroids, yet their combined mass is under 4% of the Moon’s.', 'Spacecraft cross the belt routinely; neighbors are usually hundreds of thousands of km apart.']
    }
  };
}

function pickAt(cx, cy) {
  const W = window.innerWidth, H = window.innerHeight, tanH = Math.tan(camera.fov * DEG / 2), pickPx = coarse ? 26 : 15;
  let bestA = null, bestAD = Infinity, bestB = null, bestBD = Infinity;
  for (const b of bodies) {
    if (!b.isActive()) continue;
    b.getPos(tv1);
    const camDist = camera.position.distanceTo(tv1);
    tv2.copy(tv1).project(camera);
    if (tv2.z > 1 || tv2.z < -1) continue;
    const sx = (tv2.x * 0.5 + 0.5) * W, sy = (-tv2.y * 0.5 + 0.5) * H, dd = Math.hypot(cx - sx, cy - sy);
    const rPx = b.radius * (b.ellMax || 1) / (camDist * tanH) * (H / 2);
    if (dd <= rPx) { const score = camDist - b.radius; if (score < bestAD) { bestAD = score; bestA = b; } }
    else if (dd <= pickPx * (b.cat === 'comet' ? 1.3 : 1) && dd < bestBD) { bestBD = dd; bestB = b; }
  }
  if (bestA) return bestA;
  if (state.toggles.asteroids && belt.items.length) {
    let bi = -1, bd = pickPx * 0.8;
    for (let i = 0; i < belt.items.length; i++) {
      beltWorld(i, tv1); tv2.copy(tv1).project(camera);
      if (tv2.z > 1 || tv2.z < -1) continue;
      const dd = Math.hypot(cx - (tv2.x * 0.5 + 0.5) * W, cy - (-tv2.y * 0.5 + 0.5) * H);
      if (dd < bd) { bd = dd; bi = i; }
    }
    if (bi >= 0 && (!bestB || bd < bestBD)) return asteroidTarget(bi);
  }
  return bestB;
}
function handleClick(x, y) { const t = pickAt(x, y); if (t) selectTarget(t, { focus: true }); }

function deselect(keepCam) {
  const s = state.selected;
  if (s && s.labelEl) s.labelEl.classList.remove('sel');
  state.selected = null;
  if (selShell.parent) selShell.parent.remove(selShell);
  selShell.visible = false; reticle.visible = false;
  $('#info').classList.add('hidden');
  $$('#quick button').forEach(b => b.classList.remove('on'));
  if (!keepCam) cam.following = null;
  updateOrbitHighlight();
}
function selectTarget(t, opts) {
  opts = opts || {};
  if (!t) return;
  if (t.cat === 'moon' && !state.toggles.moons) setToggle('moons', true);
  if (t.cat === 'comet' && !state.toggles.comets) setToggle('comets', true);
  if (t.cat === 'asteroid' && !state.toggles.asteroids) setToggle('asteroids', true);
  if (state.selected && state.selected.labelEl) state.selected.labelEl.classList.remove('sel');
  state.selected = t;
  if (t.labelEl) t.labelEl.classList.add('sel');
  if (selShell.parent) selShell.parent.remove(selShell);
  if (t.scaleGroup && t.cat !== 'star' && t.cat !== 'comet') { t.scaleGroup.add(selShell); selShell.visible = true; } else selShell.visible = false;
  renderInfo(t);
  $('#info').classList.remove('hidden');
  $('#info').classList.remove('min');
  $$('#quick button').forEach(b => b.classList.toggle('on', b.dataset.id === t.id));
  updateOrbitHighlight();
  if (opts.focus !== false) focusOn(t);
}
function focusSelected() {
  if (!state.selected) { toast('Select an object first'); return; }
  focusOn(state.selected);
}
function updateOrbitHighlight() {
  for (const b of bodies) if (b.orbitLine) b.orbitLine.material.opacity = (state.selected === b ? 0.95 : b.orbitLine.userData.base);
}

/* ======================================================================
   10. UI
   ====================================================================== */
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

/* --- formatting --- */
function fmtSunDist(au) {
  const mkm = au * AU_MKM, s = mkm >= 1000 ? (mkm / 1000).toFixed(2) + ' billion km' : mkm.toFixed(1) + ' million km';
  return s + ' (' + (au < 10 ? au.toFixed(2) : au.toFixed(1)) + ' AU)';
}
function fmtDuration(d) {
  const a = Math.abs(d);
  if (a < 2) return (a * 24).toFixed(1) + ' hours';
  if (a < 1000) return (a < 100 ? a.toFixed(1) : fmt(Math.round(a))) + ' days';
  const y = a / 365.25;
  return (y < 100 ? y.toFixed(2) : y < 1000 ? y.toFixed(0) : fmt(Math.round(y))) + ' years';
}
function fmtHours(h) { const a = Math.abs(h); return a < 48 ? a.toFixed(2) + ' hours' : fmtDuration(a / 24); }
function fmtMass(m) {
  if (!m) return '—';
  const ex = Math.floor(Math.log10(m)), mant = m / Math.pow(10, ex);
  return mant.toFixed(2) + ' × 10<sup>' + ex + '</sup> kg';
}
function fmtMassPlain(m) { const ex = Math.floor(Math.log10(m)); return (m / Math.pow(10, ex)).toFixed(2) + ' × 10^' + ex + ' kg'; }
function fmtG(g) { return (g < 0.01 ? g.toPrecision(2) : g) + ' m/s² (' + (g / 9.807).toFixed(g / 9.807 < 0.1 ? 3 : 2) + ' g)'; }
function fmtRatio(r) { return r >= 100 ? r.toFixed(0) : r >= 10 ? r.toFixed(1) : r.toFixed(2); }

function distText(t) {
  const d = t.def;
  if (t.cat === 'star') return '— (center of the Solar System)';
  if (t.cat === 'moon') return fmtSunDist(t.parent.def.aAU) + ' · orbits ' + t.parent.name + ' at ' + fmt(d.orbitKm) + ' km';
  if (t.cat === 'comet') return d.q.toFixed(2) + ' AU at closest · ' + (d.Q < 100 ? d.Q.toFixed(1) : fmt(Math.round(d.Q))) + ' AU at farthest';
  return fmtSunDist(d.aAU);
}
function periodText(t) {
  const d = t.def;
  if (d.periodText) return d.periodText;
  const s = fmtDuration(d.periodDays);
  if (t.cat === 'moon') return s + ' around ' + t.parent.name + (d.incl > 90 ? ' (retrograde)' : '');
  if (t.cat === 'comet' && d.incl > 90) return s + ' (retrograde orbit)';
  return s;
}
function rotText(t) {
  const d = t.def;
  if (t.cat === 'moon') return fmtDuration(d.periodDays) + ' (tidally locked)';
  if (d.rotH == null) return 'Unknown';
  const h = Math.abs(d.rotH), s = h < 48 ? h.toFixed(h < 100 ? 2 : 1) + ' hours' : fmtDuration(h / 24);
  return d.rotH < 0 ? s + ' (retrograde)' : s;
}

function renderInfo(t) {
  const d = t.def, el = $('#info');
  const diam = d.diamKm >= 100 ? fmt(Math.round(d.diamKm)) : d.diamKm;
  const moonsVal = d.moonsLabel ? d.moonsLabel : (t.cat === 'planet' || t.cat === 'dwarf') ? (d.moons === 0 ? 'None' : fmt(d.moons) + (t.moons.length ? ' (' + t.moons.length + ' modeled here)' : '')) : '—';
  const gVal = d.gText ? d.gText : d.g != null ? fmtG(d.g) : '—';
  const rows = [
    ['Diameter', diam + ' km'], ['Mass', d.massKg ? fmtMass(d.massKg) : '—'],
    ['Distance from Sun', distText(t), true], ['Orbital period', periodText(t), true],
    ['Rotation period', rotText(t), true], [t.cat === 'star' ? 'Planets' : 'Moons', moonsVal],
    ['Gravity', gVal, true], ['Temperature', d.temp || '—', true]
  ];
  const canCompare = t.cat === 'planet' || t.cat === 'dwarf';
  el.innerHTML =
    '<div class="info-head"><span class="dot" style="--c:' + d.color + '"></span>' +
    '<div class="ttl"><h2>' + t.name + '</h2><span class="badge">' + d.type + '</span></div>' +
    '<button class="btn icon info-toggle" id="info-min" aria-label="Collapse">⌄</button>' +
    '<button class="btn icon" id="info-close" aria-label="Close">✕</button></div>' +
    '<div class="info-body"><div class="info-actions"><button class="btn" id="info-focus">🎯 Focus</button>' +
    (canCompare ? '<button class="btn" id="info-compare">⚖ Compare</button>' : '') + '</div>' +
    '<dl class="stats">' + rows.map(r => '<div class="stat' + (r[2] ? ' wide' : '') + '"><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl>' +
    '<p class="info-desc">' + d.desc + '</p><h3>Interesting facts</h3><ul>' + d.facts.map(f => '<li>' + f + '</li>').join('') + '</ul>' +
    (t.moons && t.moons.length ? '<h3>Moons you can visit</h3><div class="chips">' + t.moons.map(m => '<button data-id="' + m.id + '">' + m.name + '</button>').join('') + '</div>' : '') +
    (t.parent ? '<h3>Orbits</h3><div class="chips"><button data-id="' + t.parent.id + '">' + t.parent.name + '</button></div>' : '') + '</div>';
  el.scrollTop = 0;
  $('#info-close').onclick = () => deselect();
  $('#info-focus').onclick = () => focusSelected();
  $('#info-min').onclick = () => el.classList.toggle('min');
  if (canCompare) $('#info-compare').onclick = () => openCompare(t.id);
  $$('.chips button', el).forEach(b => b.onclick = () => selectTarget(byId[b.dataset.id], { focus: true }));
}

/* --- search --- */
const searchInput = $('#search-input'), resultsEl = $('#search-results');
let searchHits = [], searchIdx = 0;
function hideSearch() { resultsEl.classList.add('hidden'); }
function renderSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { hideSearch(); return; }
  const toks = q.split(/\s+/);
  searchHits = bodies.filter(b => { const h = (b.name + ' ' + b.def.type + ' ' + b.id + ' ' + (b.parent ? b.parent.name : '')).toLowerCase(); return toks.every(t => h.indexOf(t) >= 0); })
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) ? 1 : 0) - (a.name.toLowerCase().startsWith(q) ? 1 : 0)).slice(0, 8);
  searchIdx = 0;
  resultsEl.innerHTML = searchHits.length
    ? searchHits.map((b, i) => '<div class="item' + (i === 0 ? ' on' : '') + '" role="option" data-i="' + i + '"><span class="dot" style="--c:' + b.def.color + '"></span><span class="nm">' + b.name + '</span><span class="ty">' + b.def.type.split(' · ')[0] + '</span></div>').join('')
    : '<div class="none">No matching object</div>';
  resultsEl.classList.remove('hidden');
}
function pickSearch(i) {
  const b = searchHits[i]; if (!b) return;
  searchInput.value = ''; searchInput.blur(); hideSearch();
  selectTarget(b, { focus: true });
}
searchInput.addEventListener('input', renderSearch);
searchInput.addEventListener('focus', renderSearch);
searchInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); if (!searchHits.length) return;
    searchIdx = (searchIdx + (e.key === 'ArrowDown' ? 1 : searchHits.length - 1)) % searchHits.length;
    $$('.item', resultsEl).forEach((n, i) => n.classList.toggle('on', i === searchIdx));
  } else if (e.key === 'Enter') { e.preventDefault(); pickSearch(searchIdx); }
});
resultsEl.addEventListener('pointerdown', e => { const n = e.target.closest('.item'); if (n) { e.preventDefault(); pickSearch(+n.dataset.i); } });
document.addEventListener('pointerdown', e => { if (!e.target.closest('#search')) hideSearch(); });

/* --- quick jump --- */
function buildQuick() {
  const ids = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'ceres', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'halley'];
  $('#quick').innerHTML = ids.map(id => '<button data-id="' + id + '">' + byId[id].name + '</button>').join('');
  $$('#quick button').forEach(b => b.onclick = () => selectTarget(byId[b.dataset.id], { focus: true }));
}

/* --- compare --- */
const cmpA = $('#cmp-a'), cmpB = $('#cmp-b');
function buildCompareOptions() {
  const opts = bodies.filter(b => b.cat === 'planet' || b.cat === 'dwarf')
    .map(b => '<option value="' + b.id + '">' + b.name + (b.cat === 'dwarf' ? ' (dwarf planet)' : '') + '</option>').join('');
  cmpA.innerHTML = opts; cmpB.innerHTML = opts; cmpA.value = 'earth'; cmpB.value = 'mars';
}
function renderCompare() {
  const A = byId[cmpA.value].def, B = byId[cmpB.value].def;
  const rows = [
    ['Diameter', A.diamKm, B.diamKm, v => fmt(Math.round(v)) + ' km'],
    ['Mass', A.massKg, B.massKg, fmtMassPlain],
    ['Surface gravity', A.g, B.g, v => v + ' m/s²'],
    ['Distance from Sun', A.aAU, B.aAU, fmtSunDist],
    ['Orbital period', A.periodDays, B.periodDays, fmtDuration],
    ['Rotation period', Math.abs(A.rotH), Math.abs(B.rotH), fmtHours],
    ['Moons', A.moons, B.moons, v => String(v)]
  ];
  const mx = Math.max(A.diamKm, B.diamKm), sz = d => Math.max(14, 120 * d / mx);
  let html = '<div class="cmp-heads"><div class="cmp-planet"><div class="cmp-sphere" style="--c:' + A.color + ';width:' + sz(A.diamKm) + 'px;height:' + sz(A.diamKm) + 'px"></div><b>' + A.name + '</b></div>' +
    '<div class="cmp-vs">vs</div><div class="cmp-planet"><div class="cmp-sphere" style="--c:' + B.color + ';width:' + sz(B.diamKm) + 'px;height:' + sz(B.diamKm) + 'px"></div><b>' + B.name + '</b></div></div>';
  rows.forEach(r => {
    const a = r[1], b = r[2], m = Math.max(a, b), wa = m ? Math.max(a > 0 ? 3 : 0, a / m * 100) : 0, wb = m ? Math.max(b > 0 ? 3 : 0, b / m * 100) : 0;
    const ratio = a > 0 && b > 0 ? '×' + fmtRatio(a / b) : '—';
    html += '<div class="cmp-row"><div class="cmp-label">' + r[0] + '</div><div class="cmp-vals">' +
      '<div class="cmp-cell a"><span>' + r[3](a) + '</span><i style="width:' + wa + '%"></i></div><div class="cmp-ratio">' + ratio + '</div>' +
      '<div class="cmp-cell b"><span>' + r[3](b) + '</span><i style="width:' + wb + '%"></i></div></div></div>';
  });
  $('#cmp-body').innerHTML = html;
}
function openCompare(idA) {
  if (idA && byId[idA]) { cmpA.value = idA; if (cmpB.value === idA) cmpB.value = idA === 'earth' ? 'mars' : 'earth'; }
  renderCompare(); $('#compare').classList.remove('hidden');
}
function closeModals() { $('#compare').classList.add('hidden'); $('#help').classList.add('hidden'); }
cmpA.onchange = renderCompare; cmpB.onchange = renderCompare;
$('#cmp-swap').onclick = () => { const t = cmpA.value; cmpA.value = cmpB.value; cmpB.value = t; renderCompare(); };
$('#cmp-close').onclick = closeModals; $('#help-close').onclick = closeModals;
$$('.modal').forEach(m => m.addEventListener('pointerdown', e => { if (e.target === m) closeModals(); }));
$('#btn-compare').onclick = () => { const s = state.selected; openCompare(s && (s.cat === 'planet' || s.cat === 'dwarf') ? s.id : null); };
$('#btn-help').onclick = () => $('#help').classList.remove('hidden');

/* --- toggles / dock --- */
function applyToggles() {
  const T = state.toggles;
  for (const b of bodies) {
    if (b.orbitLine) b.orbitLine.visible = T.orbits;
    if (b.cat === 'moon') b.planeTilt.visible = T.moons;
  }
  cometRoot.visible = T.comets; tailRoot.visible = T.comets;
  belt.root.visible = T.asteroids; kuiper.group.visible = T.kuiper; oort.group.visible = T.oort;
  labelsEl.style.display = T.labels ? 'block' : 'none';
  const s = state.selected;
  if (s && !s.isActive()) deselect();
}
function setToggle(key, val) {
  state.toggles[key] = val;
  const cb = $('input[data-toggle="' + key + '"]'); if (cb) cb.checked = val;
  applyToggles();
}
$$('#layers input[data-toggle]').forEach(cb => cb.addEventListener('change', () => setToggle(cb.dataset.toggle, cb.checked)));
$('#btn-layers').onclick = () => $('#layers').classList.toggle('closed');
if (window.innerWidth < 760) $('#layers').classList.add('closed');

function setPlaying(v) {
  state.playing = v;
  $('#btn-play').classList.toggle('active', v); $('#btn-pause').classList.toggle('active', !v);
}
$('#btn-play').onclick = () => setPlaying(true);
$('#btn-pause').onclick = () => setPlaying(false);
const speedIn = $('#speed');
function updateSpeed() {
  state.speed = 0.05 * Math.pow(400, speedIn.value / 100);
  $('#speed-out').textContent = (state.speed < 1 ? state.speed.toFixed(2) : state.speed.toFixed(1)) + '×';
}
speedIn.addEventListener('input', updateSpeed); updateSpeed();
$('#btn-zoom-in').onclick = () => zoomBy(0.6);
$('#btn-zoom-out').onclick = () => zoomBy(1 / 0.6);
$('#btn-reset').onclick = () => resetCamera();
$('#btn-focus').onclick = () => focusSelected();
$$('#mode-seg button').forEach(b => b.onclick = () => setCameraMode(b.dataset.mode));
$$('#scale-seg button').forEach(b => b.onclick = () => setScale(b.dataset.scale));

/* ======================================================================
   11. UPDATE LOOP + INIT
   ====================================================================== */
let simT = 0, animT = 0;

function kepler(M, e) {
  M = M % TAU; if (M < 0) M += TAU;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

function updateBodies() {
  for (const b of bodies) {
    if (b.cat === 'star') { b.surface.rotation.y = b.spinPhase + b.spinRate * simT; continue; }
    b.M = b.M0 + TAU * simT / b.Pvis;
    if (b.cat === 'moon') {
      b.holder.position.set(b.a * Math.cos(b.M), 0, -b.a * Math.sin(b.M));
      b.surface.rotation.y = b.M + Math.PI;
    } else {
      const E = kepler(b.M, b.e);
      b.holder.position.set(b.a * (Math.cos(E) - b.e), 0, -b.b * Math.sin(E));
      b.surface.rotation.y = b.spinPhase + b.spinRate * simT;
      if (b.clouds) b.clouds.rotation.y = b.spinPhase + b.spinRate * 1.12 * simT;
    }
  }
  for (let l = 0; l < BELT_LAYERS; l++) belt.groups[l].rotation.y = TAU * simT / clamp(12 * Math.pow(365.25 * Math.pow(BELT_AU0 + (l + 0.5) * BELT_SPAN / BELT_LAYERS, 1.5) / 88, 0.55), 2.5, 700);
  kuiper.group.rotation.y = TAU * simT / 593;
}

function updateComets() {
  const edu = state.scale === 'edu', lenScale = edu ? 1 : 7;
  for (const b of bodies) {
    if (b.cat !== 'comet') continue;
    b.getPos(tv1);
    const d = tv1.length(), dn = d / (edu ? 300 : 3300);
    tv2.copy(tv1).normalize();                       // direction away from the Sun
    const len = clamp(46 / (0.3 + dn * 1.4), 8, 80) * lenScale;
    const op = clamp(1.25 - dn * 0.9, 0.18, 1);
    tv3.copy(tv1).sub(b.prev);
    if (tv3.lengthSq() > 1e-10) { tv3.normalize(); b.dustDir.copy(tv2).addScaledVector(tv3, -0.45).normalize(); }
    b.prev.copy(tv1);
    b.ion.position.copy(tv1); b.dust.position.copy(tv1);
    tv3.set(0, -1, 0);
    b.ion.quaternion.setFromUnitVectors(tv3, tv2);
    b.dust.quaternion.setFromUnitVectors(tv3, b.dustDir);
    b.ion.scale.set(len * 0.045, len, len * 0.045); b.dust.scale.set(len * 0.1, len * 0.7, len * 0.1);
    b.ion.material.uniforms.uOpacity.value = op; b.dust.material.uniforms.uOpacity.value = op * 0.8;
    b.coma.scale.setScalar((edu ? 6 : 18) * (0.6 + 0.6 * op)); b.coma.material.opacity = 0.35 + 0.55 * op;
    b.surface.rotation.y = b.spinPhase + b.spinRate * simT;
  }
}

function updateRings() {
  for (const b of bodies) {
    if (!b.ringMesh) continue;
    b.getPos(tv1);
    const u = b.ringMesh.material.uniforms; u.uCenter.value.copy(tv1); u.uRadius.value = b.radius;
  }
}

function updateSelectionFX() {
  const t = state.selected;
  if (!t || !t.isActive()) { reticle.visible = false; return; }
  t.getPos(tv1);
  const dist = camera.position.distanceTo(tv1), tanH = Math.tan(camera.fov * DEG / 2), H = window.innerHeight;
  const pxR = t.radius / (dist * tanH) * (H / 2);
  const show = pxR < H * 0.12 || t.cat === 'asteroid';
  reticle.visible = show;
  if (show) {
    reticle.position.copy(tv1);
    reticle.scale.setScalar(Math.max(t.radius * 3.2, dist * tanH * 2 * 0.05) * (1 + 0.05 * Math.sin(animT * 3)));
    reticle.material.rotation = animT * 0.6;
  }
}

function updateLabels() {
  if (!state.toggles.labels) return;
  const W = window.innerWidth, H = window.innerHeight, tanH = Math.tan(camera.fov * DEG / 2);
  for (const b of bodies) {
    const el = b.labelEl; let show = b.isActive();
    if (show) {
      b.getPos(tv1);
      const dist = camera.position.distanceTo(tv1), pxR = b.radius / (dist * tanH) * (H / 2);
      if (b.cat === 'moon') {
        const pd = camera.position.distanceTo(b.parent.getPos(tv2));
        show = pd < Math.max(70, b.parent.radius * 34) || state.selected === b || state.selected === b.parent;
      }
      tv2.copy(tv1).project(camera);
      if (tv2.z > 1 || pxR > H * 0.45) show = false;
      if (show) {
        const x = (tv2.x * 0.5 + 0.5) * W, y = (-tv2.y * 0.5 + 0.5) * H - Math.min(pxR, H * 0.4) - 6;
        el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translate(-50%,-100%)';
      }
    }
    if (show !== el._on) { el.style.display = show ? 'block' : 'none'; el._on = show; }
  }
}

function update(dt) {
  animT += dt;
  if (state.playing) simT += dt * state.speed;
  updateBodies();
  scene.updateMatrixWorld(true);
  updateComets();
  updateRings();
  byId.sun.sunMat.uniforms.uTime.value = animT;
  dust.group.rotation.y = animT * 0.004;
  updateCamera(dt);
  camera.updateMatrixWorld();
  starfield.position.copy(camera.position);
  updateSelectionFX();
  updateLabels();
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  update(dt);
  renderer.render(scene, camera);
}

async function init() {
  progress(0.02, 'Lighting the stars…');
  await tick();
  buildStars(); buildDust(); buildOort(); buildKuiper(); buildBelt();
  progress(0.1, 'Igniting the Sun…');
  await tick();
  createBody(SUN_DEF);

  const total = PLANETS.length + DWARFS.length + MOONS.length + COMETS.length;
  let n = 0;
  const step = async (name) => { n++; progress(0.1 + 0.85 * n / total, 'Painting ' + name + '…'); await tick(); };

  for (const d of PLANETS) { createBody(d); await step(d.name); }
  for (const d of DWARFS) { createBody(d); await step(d.name); }
  for (const d of MOONS) { createBody(d, byId[d.parent]); await step(d.name); }
  for (const d of COMETS) { createBody(d); await step(d.name); }

  bodies.forEach(b => { if (b.def.ell) b.ellMax = Math.max.apply(null, b.def.ell); });
  progress(0.97, 'Setting everything in motion…');
  await tick();

  applyScale();
  applyToggles();
  buildQuick();
  buildCompareOptions();
  scene.updateMatrixWorld(true);

  cam.radius = cam.gRadius = overviewRadius() * 1.6;
  cam.theta = cam.gTheta = 0.7; cam.phi = cam.gPhi = 1.12;
  focusOn(ORIGIN, overviewRadius());
  cam.anim.dur = 2.4;

  progress(1, 'Ready');
  loaderEl.classList.add('done');
  setTimeout(() => { loaderEl.style.display = 'none'; toast('Click any world to explore · drag to orbit · scroll to zoom'); }, 900);
  last = performance.now();
  requestAnimationFrame(frame);
}

init().catch(err => {
  console.error(err);
  loaderText.textContent = 'Something went wrong while building the scene: ' + (err && err.message ? err.message : err);
});

})();
