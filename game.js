/* Subway Dash 3D — Three.js endless runner (Subway Surfers style)
   Curved track, day/night cycle, weather, procedural textures/audio, mobile-first. */
import * as THREE from 'three';

/* ================= CONFIG ================= */
const CFG = {
  laneW: 2.4,
  lanes: [-2.4, 0, 2.4],
  segLen: 24,
  segsAhead: 9,
  radius: 90,             // track curvature radius (gentle arc, no corners)
  speed0: 12, speedMax: 26, accel: 0.22,
  jumpV: 9.2, grav: 26,
  rollTime: 0.7,
  coinVal: 10,
};
const BIOMES = [
  { name: 'DAY',     sky: 0x8ec9ff, fog: 0xb6dcff, ground: 0x8fbf5a, wall: 0xb9a68d, night: 0 },
  { name: 'SUNSET',  sky: 0xffa25e, fog: 0xffc28a, ground: 0xb98a55, wall: 0xd9a06d, night: 0.25 },
  { name: 'NIGHT',   sky: 0x2c4260, fog: 0x46618a, ground: 0x56646e, wall: 0x5d6a80, night: 1 },
  { name: 'RAIN',    sky: 0x7d97a8, fog: 0x9db6c4, ground: 0x77817f, wall: 0x8d949c, night: 0.35, weather: 'rain' },
  { name: 'SNOW',    sky: 0xd8ecff, fog: 0xc2dcf2, ground: 0xf2f6fa, wall: 0xaebccb, night: 0.15, weather: 'snow' },
];
const BIOME_LEN = 420;    // metres per biome

/* ================= STATE ================= */
let scene, camera, renderer, clock;
let lights = {};
let player, playerGroup, jetpack = null;
let gameState = 'menu';   // menu | playing | over
let paused = false;
let speed, dist, score, coins, combo, comboT, multiplier;
let lane = 1, laneX = 0, targetLaneX = 0;
let py = 0, vy = 0, grounded = true, rolling = 0, jumping = false;
let alive = true, deathT = 0;
let biomeIdx = 0, biomeT = 0, night = 0;
let weather = 0, weatherType = null, lightningT = 0;
let timeOfDay = 0.25;
let lastTime = 0, fpsAcc = 0, fpsN = 0, fpsShown = 0;
let shake = 0, flash = 0;
let invuln = 0;
let power = 0;           // jetpack fuel
let muted = false;
let best = +(localStorage.getItem('sd_best') || 0);
let bestCoins = +(localStorage.getItem('sd_coins') || 0);
let selectedChar = 0;
const input = { left: false, right: false, jump: false, roll: false };
const segments = [];
const particles = [];
const pool = { sparks: [], puffs: [] };
let rain, snow, rainGeo, snowGeo, starField;
let followLight, lampLights = [];
let hudEls = {};

/* ================= TRACK CURVE (arc, no corners) ================= */
const R = CFG.radius;
function trackX(z) { return R - Math.sqrt(Math.max(0, R * R - z * z)); }
function trackAngle(z) { return Math.asin(THREE.MathUtils.clamp(z / R, -1, 1)); }
function makeTrackStripGeo(z0, len, halfWidth, segs = 16, y = 0) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segs; i++) {
    const z = z0 + (i / segs) * len;
    const x = trackX(z);
    positions.push(x - halfWidth, y, z, x + halfWidth, y, z);
    const v = i / segs;
    uvs.push(0, v, 1, v);
    if (i < segs) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/* ================= PROCEDURAL TEXTURES ================= */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177 | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function makeTex(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); fn(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function texRoad() {
  return makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8d9196'; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = hash2(x, y); const i = (y * w + x) * 4;
      const v = (n - .5) * 26;
      img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
    }
    ctx.putImageData(img, 0, 0);
    // lane divider lines
    ctx.strokeStyle = 'rgba(245,245,235,.75)'; ctx.lineWidth = 5; ctx.setLineDash([26, 22]);
    ctx.beginPath(); ctx.moveTo(w * .333, 0); ctx.lineTo(w * .333, h);
    ctx.moveTo(w * .666, 0); ctx.lineTo(w * .666, h); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(18, h); ctx.moveTo(w - 18, 0); ctx.lineTo(w - 18, h); ctx.stroke();
    // sleepers / rails hint on edges
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(60,60,66,.5)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(6, h); ctx.moveTo(w - 6, 0); ctx.lineTo(w - 6, h); ctx.stroke();
  });
}
function texWall() {
  return makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c9b79b'; ctx.fillRect(0, 0, w, h);
    // brick rows
    ctx.strokeStyle = 'rgba(90,75,55,.35)'; ctx.lineWidth = 2;
    for (let y = 0; y < h; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      const off = (y / 32) % 2 ? 32 : 0;
      for (let x = off; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 32); ctx.stroke(); }
    }
    const img = ctx.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = hash2(x + 7, y + 3); const i = (y * w + x) * 4; const v = (n - .5) * 18;
      img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v;
    }
    ctx.putImageData(img, 0, 0);
    // graffiti splashes
    for (let g = 0; g < 5; g++) {
      const gx = hash2(g, 11) * w, gy = hash2(g, 23) * h;
      ctx.fillStyle = `hsla(${Math.floor(hash2(g, 31) * 360)},80%,60%,.5)`;
      ctx.beginPath(); ctx.arc(gx, gy, 14 + hash2(g, 41) * 22, 0, 7); ctx.fill();
    }
  });
}
function texBuilding() {
  return makeTex(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9a8f80'; ctx.fillRect(0, 0, w, h);
    for (let y = 12; y < h - 10; y += 26) for (let x = 10; x < w - 14; x += 24) {
      const lit = hash2(x, y) > .45;
      ctx.fillStyle = lit ? '#ffe9a0' : '#3c4450';
      ctx.fillRect(x, y, 14, 18);
      ctx.strokeStyle = 'rgba(40,40,45,.5)'; ctx.strokeRect(x, y, 14, 18);
    }
  });
}
function texTrain() {
  return makeTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#3f7fd4'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8eef5'; ctx.fillRect(0, h * .55, w, h * .18);
    ctx.fillStyle = '#22303e';
    for (let x = 18; x < w - 30; x += 56) ctx.fillRect(x, 18, 40, 34);
    ctx.fillStyle = '#c33'; ctx.fillRect(0, h - 10, w, 10);
  });
}
function texGround() {
  return makeTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7fae52'; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = hash2(x * 3, y * 5); const i = (y * w + x) * 4;
      img.data[i] += (n - .5) * 30; img.data[i + 1] += (n - .5) * 44; img.data[i + 2] += (n - .5) * 22;
    }
    ctx.putImageData(img, 0, 0);
  });
}

/* ================= SHARED GEOMETRY / MATERIALS ================= */
let MAT = {}, GEO = {};
function buildAssets() {
  const roadT = texRoad(), wallT = texWall(), buildT = texBuilding(), trainT = texTrain(), groundT = texGround();
  roadT.repeat.set(1, 4); wallT.repeat.set(4, 1); buildT.repeat.set(2, 3); groundT.repeat.set(12, 12);
  MAT.road = new THREE.MeshLambertMaterial({ map: roadT });
  MAT.ground = new THREE.MeshLambertMaterial({ map: groundT });
  MAT.wall = new THREE.MeshLambertMaterial({ map: wallT });
  MAT.build = new THREE.MeshLambertMaterial({ map: buildT });
  MAT.train = new THREE.MeshPhongMaterial({ map: trainT, shininess: 30 });
  MAT.trainTop = new THREE.MeshLambertMaterial({ color: 0x2a5aa0 });
  MAT.obstacle = new THREE.MeshPhongMaterial({ color: 0xd8452f, shininess: 20 });
  MAT.barrier = new THREE.MeshPhongMaterial({ color: 0xf0a020, shininess: 15 });
  MAT.rail = new THREE.MeshPhongMaterial({ color: 0xb8bcc2, shininess: 60 });
  MAT.coin = new THREE.MeshPhongMaterial({ color: 0xffc832, emissive: 0x935c00, emissiveIntensity: .7, shininess: 90 });
  MAT.lamp = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  MAT.lampOff = new THREE.MeshLambertMaterial({ color: 0x555a60 });
  MAT.lampPost = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  MAT.tree = new THREE.MeshLambertMaterial({ color: 0x3f9e58 });
  MAT.trunk = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  MAT.jet = new THREE.MeshPhongMaterial({ color: 0xff8c3a, emissive: 0xff5500, emissiveIntensity: .8 });

  GEO.coin = new THREE.CylinderGeometry(.42, .42, .1, 14);
  GEO.coin.rotateX(Math.PI / 2);
  GEO.puff = new THREE.SphereGeometry(.35, 8, 6);
  GEO.spark = new THREE.TetrahedronGeometry(.12);
}

/* ================= CHARACTERS (free low-poly built-in models) ================= */
const CHARS = [
  { name: 'JAKE',  shirt: 0x3aa0ff, pants: 0x39404a, skin: 0xe8b48c, hat: 0xff5252, hair: 0x4a3320 },
  { name: 'TRICKY', shirt: 0xff5c8a, pants: 0x2f3a4a, skin: 0xd9a06f, hat: 0xffd23f, hair: 0x222222 },
  { name: 'FRANK', shirt: 0x53c46a, pants: 0x5a4a38, skin: 0xc98d5f, hat: 0x3a3f46, hair: 0x6b4a2a },
];
function buildCharacter(def) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshPhongMaterial({ color: def.shirt, shininess: 10 });
  const pants = new THREE.MeshLambertMaterial({ color: def.pants });
  const skin = new THREE.MeshLambertMaterial({ color: def.skin });
  const shoe = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(.62, .72, .34), shirt);
  body.position.y = 1.06; body.castShadow = true; g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(.44, .44, .4), skin);
  head.position.y = 1.66; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(.46, .16, .42), new THREE.MeshLambertMaterial({ color: def.hair }));
  hair.position.y = 1.9; g.add(hair);
  if (def.hat) {
    const hat = new THREE.Mesh(new THREE.BoxGeometry(.5, .12, .46), new THREE.MeshLambertMaterial({ color: def.hat }));
    hat.position.y = 1.98; g.add(hat);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(.5, .05, .22), new THREE.MeshLambertMaterial({ color: def.hat }));
    brim.position.set(0, 1.92, .32); g.add(brim);
  }
  // eyes
  const eye = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  for (const ex of [-.11, .11]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(.07, .09, .03), eye);
    e.position.set(ex, 1.68, .21); g.add(e);
  }

  // pivot limbs
  function limb(w, h, mat) {
    const geo = new THREE.BoxGeometry(w, h, w); geo.translate(0, -h / 2, 0);
    return new THREE.Mesh(geo, mat);
  }
  const legL = limb(.2, .7, pants), legR = limb(.2, .7, pants);
  legL.position.set(-.16, .72, 0); legR.position.set(.16, .72, 0);
  legL.castShadow = legR.castShadow = true;
  const footL = new THREE.Mesh(new THREE.BoxGeometry(.22, .1, .32), shoe); footL.position.y = -.72; legL.add(footL);
  const footR = new THREE.Mesh(new THREE.BoxGeometry(.22, .1, .32), shoe); footR.position.y = -.72; legR.add(footR);
  const armL = limb(.16, .6, shirt), armR = limb(.16, .6, shirt);
  armL.position.set(-.42, 1.4, 0); armR.position.set(.42, 1.4, 0);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(.15, .15, .15), skin); handL.position.y = -.62; armL.add(handL);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(.15, .15, .15), skin); handR.position.y = -.62; armR.add(handR);
  g.add(legL, legR, armL, armR);

  // backpack
  const pack = new THREE.Mesh(new THREE.BoxGeometry(.44, .5, .2), new THREE.MeshLambertMaterial({ color: 0x333a44 }));
  pack.position.set(0, 1.15, -.26); g.add(pack);

  return { group: g, body, head, legL, legR, armL, armR, def };
}

/* ================= SCENE SETUP ================= */
function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 900);
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  lights.hemi = new THREE.HemisphereLight(0xfff0dd, 0xaa8866, 1.2); scene.add(lights.hemi);
  lights.dir = new THREE.DirectionalLight(0xffffee, 1.6);
  lights.dir.position.set(18, 30, 18);
  lights.dir.castShadow = true;
  lights.dir.shadow.mapSize.set(768, 768);
  Object.assign(lights.dir.shadow.camera, { near: 5, far: 120, left: -34, right: 34, top: 40, bottom: -20 });
  lights.dir.shadow.bias = -0.0006;
  scene.add(lights.dir); scene.add(lights.dir.target);
  lights.ambient = new THREE.AmbientLight(0xfff5e0, .7); scene.add(lights.ambient);
  followLight = new THREE.PointLight(0xffe9c0, 0, 22, 1.6); scene.add(followLight);
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffdf9a, 0, 18, 1.8); scene.add(l); lampLights.push(l); }

  // stars for night
  const sg = new THREE.BufferGeometry();
  const sp = new Float32Array(400 * 3);
  for (let i = 0; i < 400; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * .9 + .1;
    sp[i * 3] = Math.cos(a) * 400 * Math.cos(e);
    sp[i * 3 + 1] = 400 * Math.sin(e) + 40;
    sp[i * 3 + 2] = Math.sin(a) * 400 * Math.cos(e);
  }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starField = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0 }));
  scene.add(starField);

  // moon
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf0f4ff }));
  moon.position.set(-160, 190, -260); moon.visible = false; scene.add(moon); lights.moon = moon;

  buildAssets();
  playerGroup = buildCharacter(CHARS[0]);
  player = playerGroup.group;
  scene.add(player);

  // weather particles
  rainGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) { rp[i * 3] = (Math.random() - .5) * 60; rp[i * 3 + 1] = Math.random() * 30; rp[i * 3 + 2] = (Math.random() - .5) * 80; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xd8efff, size: .18, transparent: true, opacity: 0 }));
  scene.add(rain);
  snowGeo = new THREE.BufferGeometry();
  const snp = new Float32Array(350 * 3);
  for (let i = 0; i < 350; i++) { snp[i * 3] = (Math.random() - .5) * 60; snp[i * 3 + 1] = Math.random() * 30; snp[i * 3 + 2] = (Math.random() - .5) * 80; }
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snp, 3));
  snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: .34, transparent: true, opacity: 0 }));
  scene.add(snow);

  clock = new THREE.Clock();
  updateBiomeColors(); updateLights();
}

/* ================= SEGMENT GENERATION ================= */
function segAt(z) { return Math.floor(z / CFG.segLen); }
function buildSegment(idx) {
  const z0 = idx * CFG.segLen;
  const grp = new THREE.Group();
  const biome = BIOMES[biomeIdx % BIOMES.length];
  const rng = (n) => hash2(idx * 31 + n, idx * 17 + 7);

  // ground + road as curved strips following the arc (no corners)
  const wz = z0 + CFG.segLen / 2;
  const groundHalf = 23, roadHalf = CFG.laneW * 1.5 + .6;
  const ground = new THREE.Mesh(makeTrackStripGeo(z0, CFG.segLen, groundHalf, 16, -0.02), MAT.ground);
  ground.receiveShadow = true;
  grp.add(ground);

  const road = new THREE.Mesh(makeTrackStripGeo(z0, CFG.segLen, roadHalf, 16, 0.01), MAT.road);
  road.receiveShadow = true;
  grp.add(road);

  // side walls with graffiti (follow the curve)
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(.6, 3.2, CFG.segLen + 2), MAT.wall);
    wall.position.set(trackX(wz) + side * (CFG.laneW * 1.5 + 1.4), 1.6, wz);
    wall.rotation.y = -trackAngle(wz);
    wall.receiveShadow = true; wall.castShadow = true;
    grp.add(wall);
  }

  // buildings behind walls (instanced boxes)
  for (let b = 0; b < 6; b++) {
    const side = b % 2 ? 1 : -1;
    const hgt = 6 + rng(b * 3) * 22;
    const bw = 5 + rng(b * 5) * 6;
    const bd = 6 + rng(b * 7) * 6;
    const bz = z0 + rng(b * 11) * CFG.segLen;
    const bx = trackX(bz) + side * (CFG.laneW * 1.5 + 4 + rng(b * 13) * 8);
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, hgt, bd), MAT.build);
    m.position.set(bx, hgt / 2, bz);
    m.castShadow = true;
    grp.add(m);
    // roof trim
    const cap = new THREE.Mesh(new THREE.BoxGeometry(bw + .6, .5, bd + .6), MAT.wall);
    cap.position.set(bx, hgt + .25, bz); grp.add(cap);
    // lamp on near side
    if (rng(b * 23) > .5) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 4.4, 6), MAT.lampPost);
      post.position.set(trackX(bz) + side * (CFG.laneW * 1.5 + .9), 2.2, bz);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), MAT.lampOff);
      head.position.y = 2.3; post.add(head);
      post.userData.lampHead = head;
      grp.add(post);
      grp.userData.lamps = grp.userData.lamps || [];
      grp.userData.lamps.push(head);
    }
  }

  // trees / bushes occasionally
  if (rng(99) > .55) {
    const tz = z0 + rng(101) * CFG.segLen;
    const side = rng(103) > .5 ? 1 : -1;
    const tx = trackX(tz) + side * (CFG.laneW * 1.5 + 2.4);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, 1.6, 6), MAT.trunk);
    trunk.position.set(tx, .8, tz);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), MAT.tree);
    crown.position.y = 2.1; trunk.add(crown);
    grp.add(trunk);
  }

  // ---- obstacles & coins ----
  const obstacles = [];
  const difficulty = Math.min(1, dist / 1500);
  const patternRoll = rng(7);
  const zc = z0 + CFG.segLen / 2;

  function addObstacle(laneIdx, type, z) {
    const lx = CFG.lanes[laneIdx];
    const wx = trackX(z) + lx;
    let mesh, box;
    if (type === 'train') {
      const len = 10 + rng(z) * 8;
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.6, len), MAT.train);
      body.position.y = 1.5; body.castShadow = true;
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, .3, len), MAT.trainTop); top.position.y = 2.9; body.add(top);
      mesh.add(body);
      mesh.position.set(wx, 0, z);
      box = { x: wx, z, hw: 1.15, hl: len / 2, h: 3, low: false, type };
    } else if (type === 'lowbar') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, .5, .8), MAT.barrier);
      mesh.position.set(wx, 1.15, z); mesh.castShadow = true;
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(.16, 1.15, .16), MAT.rail);
        leg.position.set(s * 1.05, .575, 0); mesh.add(leg);
      }
      box = { x: wx, z, hw: 1.15, hl: .5, h: 1.5, low: true, type };
    } else if (type === 'bin') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 1.5), MAT.obstacle);
      mesh.position.set(wx, .65, z); mesh.castShadow = true;
      box = { x: wx, z, hw: .8, hl: .8, h: 1.3, low: false, type };
    } else if (type === 'ramp') {
      mesh = new THREE.Group();
      const wedge = new THREE.Mesh(new THREE.BoxGeometry(2.1, .3, 3.4), MAT.barrier);
      wedge.rotation.x = -0.28; wedge.position.y = .55; wedge.castShadow = true;
      mesh.add(wedge);
      mesh.position.set(wx, 0, z);
      box = { x: wx, z, hw: 1.1, hl: 1.7, h: 1.2, low: false, type, ramp: true };
    }
    grp.add(mesh);
    obstacles.push({ mesh, box });
  }

  function addCoins(laneIdx, z, n, arc) {
    for (let i = 0; i < n; i++) {
      const cz = z + i * 1.6;
      const m = new THREE.Mesh(GEO.coin, MAT.coin);
      m.position.set(trackX(cz) + CFG.lanes[laneIdx], arc ? 1 + Math.sin(i / n * Math.PI) * 1.6 : 1.05, cz);
      m.castShadow = false;
      grp.add(m);
      obstacles.push({ mesh: m, box: { x: m.position.x, z: cz, hw: .7, hl: .7, coin: true }, coin: true, arc });
    }
  }

  // pattern: pick blocked lanes
  if (patternRoll < .18 + difficulty * .12) {
    // full train row across 2 lanes
    const l1 = Math.floor(rng(1) * 3);
    let l2 = (l1 + 1 + Math.floor(rng(2) * 2)) % 3;
    addObstacle(l1, 'train', zc + rng(3) * 6 - 3);
    if (rng(4) > .4) addObstacle(l2, 'train', zc + rng(5) * 6 - 3);
    const free = [0, 1, 2].filter(l => l !== l1 && l !== l2);
    if (free.length) addCoins(free[0], z0 + 4, 6, false);
  } else if (patternRoll < .38) {
    const l1 = Math.floor(rng(6) * 3);
    addObstacle(l1, 'lowbar', zc);
    addCoins(l1, z0 + 6, 5, true);   // jump reward
  } else if (patternRoll < .55) {
    const l1 = Math.floor(rng(8) * 3);
    addObstacle(l1, 'bin', zc - 2);
    if (rng(9) > .5) addObstacle((l1 + 1) % 3, 'bin', zc + 4);
    addCoins((l1 + 2) % 3, z0 + 5, 5, false);
  } else if (patternRoll < .68) {
    const l1 = Math.floor(rng(10) * 3);
    addObstacle(l1, 'train', zc + 3);
    addObstacle(l1, 'lowbar', zc - 6);   // combo: roll then dodge
    addCoins((l1 + 1) % 3, z0 + 4, 7, false);
  } else if (patternRoll < .76) {
    const l1 = Math.floor(rng(12) * 3);
    addObstacle(l1, 'ramp', zc);
    addCoins(l1, zc + 2, 6, true);
  } else {
    // coin lane
    const l1 = Math.floor(rng(14) * 3);
    addCoins(l1, z0 + 3, 9, rng(15) > .6);
    if (rng(16) > .75) addObstacle((l1 + 1) % 3, 'bin', zc);
  }

  // power-up (jetpack) rare
  if (rng(17) > .93 && idx > 2) {
    const l1 = Math.floor(rng(18) * 3);
    const m = new THREE.Mesh(new THREE.BoxGeometry(.7, .9, .5), MAT.jet);
    m.position.set(trackX(zc) + CFG.lanes[l1], 1.2, zc);
    m.castShadow = true;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(.55, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: .35 }));
    m.add(glow);
    grp.add(m);
    obstacles.push({ mesh: m, box: { x: m.position.x, z: zc, hw: .9, hl: .9, power: true }, power: true });
  }

  grp.userData.obstacles = obstacles;
  grp.userData.idx = idx;
  scene.add(grp);
  segments.push(grp);
}

function generateAhead() {
  const need = segAt(dist + CFG.segsAhead * CFG.segLen);
  let have = segments.length ? segments[segments.length - 1].userData.idx : -1;
  while (have < need) { have++; buildSegment(have); }
}
function cleanupBehind() {
  const minIdx = segAt(dist) - 2;
  while (segments.length && segments[0].userData.idx < minIdx) {
    const s = segments.shift();
    s.traverse(o => { if (o.geometry && o.geometry !== GEO.coin && o.geometry !== GEO.puff && o.geometry !== GEO.spark) o.geometry.dispose(); });
    scene.remove(s);
  }
}

/* ================= BIOME / LIGHTS ================= */
function lerpColor(a, b, t) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.lerp(cb, t);
}
function updateBiomeColors() {
  const b = BIOMES[biomeIdx % BIOMES.length];
  const nb = BIOMES[(biomeIdx + 1) % BIOMES.length];
  const t = biomeT / BIOME_LEN;
  const sky = lerpColor(b.sky, nb.sky, t);
  const fog = lerpColor(b.fog, nb.fog, t);
  scene.background = sky;
  if (!scene.fog) scene.fog = new THREE.Fog(fog, 60, 320);
  scene.fog.color.copy(fog);
  renderer.setClearColor(sky);

  const nightA = b.night + (nb.night - b.night) * t;
  night = nightA;
  timeOfDay = (1 - nightA) * .5;
  const moon = lights.moon;
  if (moon) {
    moon.position.set(player.position.x - 120, 150, dist - 220);
    moon.visible = night > .25;
  }
  if (starField) {
    starField.position.set(player.position.x, 0, dist - 80);
    starField.material.opacity = night * .85;
  }

  // weather blend
  const wA = b.weather === 'rain' ? 1 : b.weather === 'snow' ? 1 : 0;
  const wB = nb.weather === 'rain' ? 1 : nb.weather === 'snow' ? 1 : 0;
  const wTarget = Math.max(wA * (1 - t), wB * t);
  weather += (wTarget - weather) * .12;
  weatherType = weather > .18 ? (wA * (1 - t) >= wB * t ? b.weather : nb.weather) : null;

  rain.material.opacity = weatherType === 'rain' ? weather * .8 : 0;
  snow.material.opacity = weatherType === 'snow' ? weather * .9 : 0;
  starField.material.opacity = night * .8;
  lights.moon.visible = night > .4;

  // fog density by weather
  scene.fog.near = weatherType === 'rain' ? 40 : weatherType === 'snow' ? 50 : 70;
  scene.fog.far = weatherType ? 220 : 340;
}
function updateLights() {
  const dayF = 1 - night;
  lights.hemi.intensity = Math.max(.75, .45 + dayF * .75);
  lights.hemi.color.setHex(night > .5 ? 0x8899bb : 0xfff0dd);
  lights.hemi.groundColor.setHex(night > .5 ? 0x33404f : 0xaa8866);
  lights.dir.intensity = Math.max(.35, .12 + dayF * 1.48);
  lights.dir.color.setHex(night > .5 ? 0x9ab0d0 : 0xfff2dc);
  lights.dir.position.set(18 + night * 30, 30, 18);
  lights.dir.target.position.set(player.position.x, 0, dist + 22);
  lights.ambient.intensity = Math.max(.35, .18 + dayF * .52);
  renderer.toneMappingExposure = 1.5 + night * .35;

  followLight.position.set(player.position.x, 4, dist + 2);
  followLight.intensity = 1.5 + night * 12;

  // nearest lamps get real lights + glow heads
  let li = 0;
  for (const s of segments) {
    const lamps = s.userData.lamps;
    if (!lamps) continue;
    for (const head of lamps) {
      if (li >= lampLights.length) break;
      const wp = new THREE.Vector3(); head.getWorldPosition(wp);
      if (Math.abs(wp.z - dist) < 75) {
        const L = lampLights[li++];
        L.position.copy(wp); L.intensity = 2 + night * 18;
        head.material = night > .25 ? MAT.lamp : MAT.lampOff;
      }
    }
  }
  for (; li < lampLights.length; li++) lampLights[li].intensity = 0;
}

/* ================= PLAYER ================= */
function updatePlayer(dt) {
  // lane switch
  targetLaneX = CFG.lanes[lane];
  laneX += (targetLaneX - laneX) * Math.min(1, dt * 11);
  const a = trackAngle(dist);
  const cx = trackX(dist), cz = dist;
  const nx = -Math.sin(a), nz = Math.cos(a);
  player.position.set(cx + nx * laneX, py, cz + nz * laneX);
  player.rotation.y = -a + (laneX - targetLaneX) * .12;

  // jump / gravity
  if (!grounded) {
    vy -= CFG.grav * dt;
    py += vy * dt;
    if (jetpack && power > 0) { py = Math.min(py + 4 * dt, 6); vy = Math.max(vy, 1); }
    if (py <= 0) { py = 0; vy = 0; grounded = true; jumping = false; landFX(); }
  }
  if (rolling > 0) rolling -= dt;

  // run animation
  const t = clock.elapsedTime;
  const runSpeed = speed * .55;
  const air = !grounded;
  const rollPose = rolling > 0;
  const legAmp = air ? .3 : 1.1, armAmp = air ? 1.9 : 1.0;
  playerGroup.legL.rotation.x = Math.sin(t * runSpeed) * legAmp;
  playerGroup.legR.rotation.x = -Math.sin(t * runSpeed) * legAmp;
  playerGroup.armL.rotation.x = -Math.sin(t * runSpeed) * armAmp;
  playerGroup.armR.rotation.x = Math.sin(t * runSpeed) * armAmp;
  if (air) {
    playerGroup.legL.rotation.x = -.5; playerGroup.legR.rotation.x = .2;
  }
  playerGroup.body.position.y = 1.06 + (air ? 0 : Math.abs(Math.sin(t * runSpeed)) * .06);
  playerGroup.body.rotation.x = rollPose ? 1.3 : (air ? -.2 : 0);
  playerGroup.group.scale.y = rollPose ? .55 : 1;
  playerGroup.head.rotation.x = rollPose ? .6 : 0;

  // jetpack flame
  if (jetpack) {
    jetpack.flame.scale.setScalar(1 + Math.sin(t * 30) * .2);
    if (Math.random() > .6) spawnParticle('puff', player.position.x, py + .2, dist - .5, 0, -2, 0, .4);
  }
}

/* ================= CAMERA ================= */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt) {
  // Subway Surfers framing: hero pinned in the lower third of the frame,
  // camera rides the curve behind him.
  const a = trackAngle(dist);
  const px = player.position.x, pz = player.position.z;
  const nx = -Math.sin(a), nz = Math.cos(a);
  camPos.set(px - nx * 1.2, 4.2 + py * .35, pz - nz * 7);
  if (deathT > 0) camPos.y = Math.max(1.2, camPos.y - deathT * 2.5);
  if (shake > 0) {
    camPos.x += (Math.random() - .5) * shake; camPos.y += (Math.random() - .5) * shake;
    shake = Math.max(0, shake - dt * 2.2);
  }
  camera.position.lerp(camPos, Math.min(1, dt * 7));
  // look at a point on the track ahead, biased by lane
  const la = trackAngle(dist + 16);
  const lx = -Math.sin(la), lz = Math.cos(la);
  camLook.set(trackX(dist + 16) + lx * laneX * .5, 1.7 + py * .4, dist + 16 + lz * laneX * .5);
  camera.lookAt(camLook);
  lights.dir.target.position.set(player.position.x, 0, dist + 22);
}

/* ================= COLLISIONS / PICKUPS ================= */
function checkCollisions() {
  const px = player.position.x, pz = dist, ph = rolling > 0 ? .7 : 1.8;
  for (const s of segments) {
    if (Math.abs(s.userData.idx * CFG.segLen + CFG.segLen / 2 - dist) > CFG.segLen * 1.2) continue;
    for (const o of s.userData.obstacles) {
      if (o.taken) continue;
      const b = o.box;
      const dx = Math.abs(px - b.x), dz = Math.abs(pz - b.z);
      if (dx < b.hw + .35 && dz < b.hl + .35) {
        if (o.coin) {
          o.taken = true; o.mesh.visible = false;
          coins++; combo++; comboT = 2;
          multiplier = 1 + Math.min(9, Math.floor(combo / 5));
          score += CFG.coinVal * multiplier;
          sfxCoin(); spawnParticle('spark', b.x, 1.2, b.z, 0, 3, 0, .35);
          continue;
        }
        if (o.power) {
          o.taken = true; o.mesh.visible = false;
          startJetpack(); sfxPower();
          continue;
        }
        // solid obstacle
        if (jetpack && power > 0 && py > 2.2) continue;      // flying over
        if (b.type === 'lowbar') {
          if (py > 1.15) continue;                            // jumped over
          if (rolling > 0) continue;                          // rolled under
          die(); return;
        }
        if (b.ramp && py > .8) {                              // launched by ramp
          vy = 8.5; grounded = false; jumping = true;
          continue;
        }
        if (py > b.h - .25) continue;                         // above it
        if (invuln > 0) continue;
        die(); return;
      }
    }
  }
}

/* ================= JETPACK ================= */
function startJetpack() {
  if (jetpack) return;
  power = 6;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.22, .7, 8), new THREE.MeshBasicMaterial({ color: 0xff9a3a }));
  flame.position.set(0, .75, -.34); flame.rotation.x = Math.PI;
  player.add(flame);
  jetpack = { flame };
  hudEls.power.classList.add('on');
}
function endJetpack() {
  if (!jetpack) return;
  player.remove(jetpack.flame);
  jetpack = null;
  hudEls.power.classList.remove('on');
  explosionFX(player.position.x, py, dist, .6);
}

/* ================= DEATH ================= */
function die() {
  if (!alive) return;
  alive = false; deathT = 0; gameState = 'over';
  shake = 1.2; sfxCrash();
  explosionFX(player.position.x, py + .8, dist, 1);
  endJetpack();
  if (score > best) { best = score; localStorage.setItem('sd_best', best); }
  localStorage.setItem('sd_coins', bestCoins = Math.max(bestCoins, coins));
  setTimeout(() => {
    hudEls.finalScore.textContent = score;
    hudEls.finalCoins.textContent = coins;
    hudEls.finalBest.textContent = best;
    hudEls.over.classList.remove('hidden');
  }, 900);
}

/* ================= PARTICLES ================= */
function spawnParticle(kind, x, y, z, vx, vy, vz, life) {
  if (particles.length > 90) return;
  const geo = kind === 'puff' ? GEO.puff : GEO.spark;
  const mat = new THREE.MeshBasicMaterial({ color: kind === 'puff' ? 0xdddddd : 0xffcf5a, transparent: true, opacity: .9 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  scene.add(m);
  particles.push({ m, vx, vy, vz, t: 0, life, kind, grav: kind === 'puff' ? 1.5 : -9, grow: kind === 'puff' ? 1.6 : 0 });
}
function landFX() {
  for (let i = 0; i < 4; i++) spawnParticle('puff', player.position.x + (Math.random() - .5), .15, dist - .3, (Math.random() - .5) * 2, 1.5, (Math.random() - .5) * 2, .4);
  sfxStep();
}
function explosionFX(x, y, z, scale) {
  for (let i = 0; i < 14 * scale; i++) {
    spawnParticle('spark', x, y, z, (Math.random() - .5) * 10, Math.random() * 8, (Math.random() - .5) * 10, .5 + Math.random() * .4);
  }
  for (let i = 0; i < 6 * scale; i++) spawnParticle('puff', x, y, z, (Math.random() - .5) * 3, 2 + Math.random() * 2, (Math.random() - .5) * 3, .7);
  flash = .5 * scale;
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { scene.remove(p.m); p.m.material.dispose(); particles.splice(i, 1); continue; }
    p.vy += p.grav * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.material.opacity = .9 * (1 - p.t / p.life);
    if (p.grow) p.m.scale.setScalar(1 + p.t * p.grow);
  }
}

/* ================= WEATHER UPDATE ================= */
function updateWeather(dt) {
  if (weatherType === 'rain' && rain.material.opacity > 0) {
    const pos = rainGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] -= 32 * dt;
      if (pos[i + 1] < 0) { pos[i + 1] = 28; pos[i] = player.position.x + (Math.random() - .5) * 50; pos[i + 2] = dist + (Math.random() - .5) * 70; }
    }
    rainGeo.attributes.position.needsUpdate = true;
    lightningT -= dt;
    if (lightningT <= 0 && Math.random() > .985) { flash = .8; lightningT = 3; sfxThunder(); }
  }
  if (weatherType === 'snow' && snow.material.opacity > 0) {
    const pos = snowGeo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] -= 5 * dt; pos[i] += Math.sin(clock.elapsedTime + i) * dt * .6;
      if (pos[i + 1] < 0) { pos[i + 1] = 26; pos[i] = player.position.x + (Math.random() - .5) * 50; pos[i + 2] = dist + (Math.random() - .5) * 70; }
    }
    snowGeo.attributes.position.needsUpdate = true;
  }
  if (flash > 0) {
    flash = Math.max(0, flash - dt * 2.5);
    lights.ambient.intensity += flash * 3;
  }
}

/* ================= AUDIO (procedural WebAudio, no downloads) ================= */
let AC = null, masterGain, musicNodes = [];
function audioInit() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = AC.createGain(); masterGain.gain.value = muted ? 0 : .5;
  masterGain.connect(AC.destination);
}
function beep(freq, dur, type = 'sine', vol = .3, slide = 0) {
  if (!AC || muted) return;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), AC.currentTime + dur);
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, AC.currentTime + dur);
  o.connect(g); g.connect(masterGain);
  o.start(); o.stop(AC.currentTime + dur);
}
function noiseBurst(dur, vol = .5, lp = 1200) {
  if (!AC || muted) return;
  const n = AC.createBufferSource();
  const buf = AC.createBuffer(1, AC.sampleRate * dur, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = AC.createGain(); g.gain.value = vol;
  n.connect(f); f.connect(g); g.connect(masterGain);
  n.start();
}
function sfxCoin() { beep(1320, .09, 'square', .18); beep(1760, .14, 'square', .14); }
function sfxJump() { beep(300, .22, 'sine', .3, 420); }
function sfxRoll() { noiseBurst(.25, .3, 900); }
function sfxStep() { noiseBurst(.06, .12, 500); }
function sfxCrash() { noiseBurst(.5, .8, 700); beep(120, .5, 'sawtooth', .4, -60); }
function sfxPower() { beep(440, .15, 'square', .25, 440); beep(880, .3, 'square', .2, 440); }
function sfxThunder() { noiseBurst(1.2, .5, 300); }
function sfxLane() { beep(520, .06, 'triangle', .12, 120); }

// ambient music: simple arpeggio loop
let musicTimer = null;
function musicStart() {
  if (!AC || musicTimer) return;
  const scale = [220, 262, 330, 392, 440, 523];
  let step = 0;
  musicTimer = setInterval(() => {
    if (muted || gameState !== 'playing') return;
    const f = scale[step % scale.length] * (night > .5 ? .5 : 1);
    beep(f, .18, 'triangle', .05);
    if (step % 4 === 0) beep(f / 2, .3, 'sine', .06);
    step++;
  }, 240);
}
function musicStop() { clearInterval(musicTimer); musicTimer = null; }

/* ================= INPUT ================= */
function doJump() {
  if (grounded && alive) {
    vy = CFG.jumpV; grounded = false; jumping = true; sfxJump();
  }
}
function doRoll() {
  if (alive && rolling <= 0) { rolling = CFG.rollTime; sfxRoll(); if (!grounded) { vy = -14; } }
}
function doLeft() { if (lane > 0) { lane--; sfxLane(); } }
function doRight() { if (lane < 2) { lane++; sfxLane(); } }

addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') doLeft();
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') doRight();
  else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') doJump();
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') doRoll();
});

// touch: swipe anywhere + tap zones
let touchStart = null;
addEventListener('touchstart', e => {
  audioInit();
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
}, { passive: true });
addEventListener('touchend', e => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
  const dtms = performance.now() - touchStart.t;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < 24 && ady < 24 && dtms < 350) { doJump(); touchStart = null; return; }  // tap = jump
  if (adx > ady) { dx > 0 ? doRight() : doLeft(); }
  else { dy > 0 ? doRoll() : doJump(); }
  touchStart = null;
}, { passive: true });

/* ================= HUD ================= */
function initHUD() {
  hudEls = {
    hud: document.getElementById('hud'),
    score: document.getElementById('score'),
    coins: document.getElementById('coins'),
    mult: document.getElementById('multiplier'),
    power: document.getElementById('powerbar'),
    menu: document.getElementById('menu'),
    over: document.getElementById('over'),
    finalScore: document.getElementById('final-score'),
    finalCoins: document.getElementById('final-coins'),
    finalBest: document.getElementById('final-best'),
    best: document.getElementById('best'),
    fps: document.getElementById('fps'),
  };
  hudEls.best.textContent = best ? `РЕКОРД: ${best}` : '';
}

/* ================= MENU ================= */
let menuRun = null;
function buildMenuRun() {
  menuRun = { z: 0 };
  for (let i = 0; i < 4; i++) buildSegment(i);
  dist = 6;
  hudEls.best.textContent = best ? `РЕКОРД: ${best}` : '';
  // character picker
  const charsEl = document.getElementById('chars');
  CHARS.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'char' + (i === selectedChar ? ' sel' : '');
    const cv = document.createElement('canvas'); cv.width = 70; cv.height = 90;
    const ctx = cv.getContext('2d');
    drawCharIcon(ctx, c);
    div.appendChild(cv);
    const b = document.createElement('b'); b.textContent = c.name; div.appendChild(b);
    div.onclick = () => {
      selectedChar = i;
      document.querySelectorAll('.char').forEach(el => el.classList.remove('sel'));
      div.classList.add('sel');
      scene.remove(player);
      playerGroup = buildCharacter(CHARS[i]);
      player = playerGroup.group;
      scene.add(player);
      beep(660, .1, 'triangle', .2);
    };
    charsEl.appendChild(div);
  });
}
function drawCharIcon(ctx, c) {
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  ctx.fillStyle = hex(c.skin); ctx.fillRect(23, 8, 24, 24);          // head
  ctx.fillStyle = hex(c.hat || c.hair); ctx.fillRect(21, 4, 28, 8);  // hat
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(28, 16, 4, 5); ctx.fillRect(38, 16, 4, 5);
  ctx.fillStyle = hex(c.shirt); ctx.fillRect(18, 34, 34, 30);        // body
  ctx.fillStyle = hex(c.pants); ctx.fillRect(20, 64, 12, 20); ctx.fillRect(38, 64, 12, 20);
  ctx.fillStyle = hex(c.shirt); ctx.fillRect(10, 36, 8, 24); ctx.fillRect(52, 36, 8, 24);
}
function menuRunUpdate(dt) {
  menuRun.z += 7 * dt;
  dist = menuRun.z;
  const a = trackAngle(dist);
  player.position.set(trackX(dist), 0, dist);
  player.rotation.y = -a;
  const t = clock.elapsedTime;
  playerGroup.legL.rotation.x = Math.sin(t * 4) * 1.0;
  playerGroup.legR.rotation.x = -Math.sin(t * 4) * 1.0;
  playerGroup.armL.rotation.x = -Math.sin(t * 4) * .9;
  playerGroup.armR.rotation.x = Math.sin(t * 4) * .9;
  playerGroup.body.position.y = 1.06 + Math.abs(Math.sin(t * 4)) * .05;
  generateAhead(); cleanupBehind();
}

/* ================= GAME FLOW ================= */
function startGame() {
  audioInit(); if (AC.state === 'suspended') AC.resume();
  // clear segments
  while (segments.length) { const s = segments.shift(); scene.remove(s); }
  dist = 0; score = 0; coins = 0; combo = 0; multiplier = 1;
  speed = CFG.speed0; lane = 1; laneX = 0; py = 0; vy = 0; grounded = true;
  alive = true; deathT = 0; rolling = 0; invuln = 1;
  biomeIdx = 0; biomeT = 0;
  endJetpack();
  gameState = 'playing'; paused = false;
  hudEls.menu.classList.add('hidden');
  hudEls.over.classList.add('hidden');
  hudEls.hud.classList.remove('hidden');
  musicStart();
  generateAhead();
}
function resetToMenu() {
  startGame();
}

document.getElementById('play').onclick = startGame;
document.getElementById('restart').onclick = startGame;
document.getElementById('mute').onclick = (e) => {
  muted = !muted;
  e.target.classList.toggle('off', muted);
  if (masterGain) masterGain.gain.value = muted ? 0 : .5;
};

/* ================= MAIN LOOP ================= */
function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  if (gameState === 'playing' && !paused && alive) {
    speed = Math.min(CFG.speedMax, speed + CFG.accel * dt);
    dist += speed * dt;
    score += speed * dt * 1.2;
    biomeT += speed * dt;
    if (biomeT >= BIOME_LEN) { biomeT = 0; biomeIdx++; }
    comboT -= dt; if (comboT <= 0) { combo = 0; multiplier = 1; }
    if (jetpack) { power -= dt; if (power <= 0) endJetpack(); }
    invuln = Math.max(0, invuln - dt);

    updatePlayer(dt);
    checkCollisions();
    generateAhead();
    cleanupBehind();
  } else if (gameState === 'menu') {
    menuRunUpdate(dt);
  } else if (gameState === 'over' && alive === false) {
    deathT = Math.min(1, deathT + dt);
  }

  updateCamera(dt);
  updateLights();
  updateBiomeColors();
  updateWeather(dt);
  updateParticles(dt);

  // HUD
  if (gameState === 'playing') {
    hudEls.score.textContent = Math.floor(score);
    hudEls.coins.textContent = coins;
    hudEls.mult.textContent = multiplier > 1 ? `x${multiplier} КОМБО` : '';
    hudEls.mult.classList.toggle('on', multiplier > 1);
    if (jetpack) hudEls.power.firstElementChild ? hudEls.power.innerHTML = `<i style="width:${power / 6 * 100}%"></i>` : null;
  }

  renderer.render(scene, camera);

  // fps meter
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= .5) {
    fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
    hudEls.fps.textContent = fpsShown + ' fps';
  }
}

/* ================= RESIZE / VISIBILITY ================= */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
document.addEventListener('visibilitychange', () => { paused = document.hidden; });

/* ================= TEST API (QA hooks) ================= */
window.gameApi = {
  skipToBiome(i) { biomeIdx = i; biomeT = 0; weather = BIOMES[i % BIOMES.length].weather ? 1 : 0; weatherType = BIOMES[i % BIOMES.length].weather || null; updateBiomeColors(); },
  godMode(on) { invuln = on ? 1e9 : 0; },
  state() { return { dist, score, coins, biomeIdx, night, weatherType, speed, lane, alive, gameState, segs: segments.length }; },
  probeCamera() {
    const p = player.position, c = camera.position;
    const v = new THREE.Vector3(p.x, p.y + 1.2, p.z).project(camera);
    return {
      player: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      cam: { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) },
      distToCam: +p.distanceTo(c).toFixed(2),
      ndc: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) }, // |x|,|y|<1 and z<1 => on screen in front
      visible: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1,
    };
  },
};

/* ================= BOOT ================= */
initScene();
initHUD();
buildMenuRun();
requestAnimationFrame(animate);
