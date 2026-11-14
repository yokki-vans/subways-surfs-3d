// Subway Dash 3D — main: прямая сцена + шейдерный изгиб, фикс. физический шаг,
// динамическое разрешение под 120fps, пулы объектов. Архитектура по референсу sprint-city-3d.
import * as THREE from 'three';
import { U } from './curve.js';
import { World, LW, ROAD_HALF, BIOMES } from './world.js';
import { Player } from './player.js';
import { Sky, Weather } from './sky.js';
import { Fx } from './fx.js';
import { Sound } from './audio.js';

const qs = new URLSearchParams(location.search);
const showFps = qs.has('fps');
const ghost = qs.has('ghost');

// ---------- renderer ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb6dcff, 60, 190);

const camera = new THREE.PerspectiveCamera(66, 1, 0.4, 700);
const camPos = new THREE.Vector3(0, 2.3, 4.6), camLook = new THREE.Vector3(0, 1.2, -3), _t = new THREE.Vector3(), _l = new THREE.Vector3();
camera.position.copy(camPos);

// ---------- свет ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa8b8, 1.0);
const dir = new THREE.DirectionalLight(0xffffff, 1.3);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.left = -14; dir.shadow.camera.right = 14;
dir.shadow.camera.top = 10; dir.shadow.camera.bottom = -10;
dir.shadow.camera.near = 1; dir.shadow.camera.far = 60;
dir.shadow.bias = -0.001;
const dirT = new THREE.Object3D();
scene.add(hemi, dir, dirT); dir.target = dirT;

// ---------- системы ----------
const world = new World(scene, (Math.random() * 1e9) | 0);
const player = new Player(scene);
const sky = new Sky(scene);
const weather = new Weather(scene);
const fx = new Fx(scene);
const sound = new Sound();

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = { score: $('score'), coins: $('coins'), mult: $('mult'), power: $('power'), fps: $('fps') };
const menu = $('menu'), over = $('over'), flash = $('flash');

// ---------- состояние ----------
let state = 'menu'; // menu | run | dead
let dist = 0, score = 0, coins = 0, mult = 1, multT = 0;
let shield = 0, magnetT = 0, x2T = 0, invuln = 0;
let speed = 12;
let tod = 0.22, night = 0, weatherI = 0, cloud = 0.25;
let shake = 0, time = 0;
const out = { coins: 0, power: null };

function setPowerUI() {
  const parts = [];
  if (magnetT > 0) parts.push(`МАГНИТ ${Math.ceil(magnetT)}с`);
  if (shield > 0) parts.push(`ЩИТ ×${shield}`);
  if (x2T > 0) parts.push(`×2 ${Math.ceil(x2T)}с`);
  hud.power.textContent = parts.join(' · ');
}

function startRun() {
  world.reset(world.biomeNow(dist).idx);
  player.reset(); player.start();
  dist = 0; score = 0; coins = 0; mult = 1; multT = 0;
  shield = 0; magnetT = 0; x2T = 0; invuln = 0; speed = 12;
  state = 'run';
  menu.hidden = true; over.hidden = true;
  sound.init(); sound.click(); sound.music(true);
  setPowerUI();
}

function die() {
  if (ghost) return;
  state = 'dead';
  player.die(world);
  sound.crash(); sound.music(false);
  fx.emit(player.x, player.y + 0.9, -player.d, 40, 0xff6a3c, { spread: 5, up: 5, life: 0.8, size: 0.5 });
  shake = 1;
  flash.style.transition = 'none'; flash.style.opacity = 0.85;
  requestAnimationFrame(() => { flash.style.transition = 'opacity .5s'; flash.style.opacity = 0; });
  const best = Math.max(score, +(localStorage.getItem('sd_best') || 0));
  localStorage.setItem('sd_best', best);
  $('finalScore').textContent = score;
  $('finalCoins').textContent = coins;
  $('bestScore').textContent = best;
  setTimeout(() => { over.hidden = false; }, 700);
}

// ---------- управление ----------
player.events = [];
function pushCmd(c) { if (state === 'run') player.input(c, world); }

let ts = null;
addEventListener('touchstart', (e) => { ts = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
addEventListener('touchend', (e) => {
  if (!ts) return;
  const dx = e.changedTouches[0].clientX - ts.x, dy = e.changedTouches[0].clientY - ts.y;
  ts = null;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) pushCmd(dx > 0 ? 'R' : 'L');
  else pushCmd(dy > 0 ? 'D' : 'U');
}, { passive: true });

addEventListener('keydown', (e) => {
  if (state === 'menu' && (e.code === 'Space' || e.code === 'Enter')) { startRun(); return; }
  if (state === 'dead' && (e.code === 'Space' || e.code === 'Enter')) { startRun(); return; }
  const k = e.code;
  if (k === 'ArrowLeft' || k === 'KeyA') pushCmd('L');
  else if (k === 'ArrowRight' || k === 'KeyD') pushCmd('R');
  else if (k === 'ArrowUp' || k === 'KeyW' || k === 'Space') { e.preventDefault(); pushCmd('U'); }
  else if (k === 'ArrowDown' || k === 'KeyS') pushCmd('D');
});

$('play').addEventListener('click', startRun);
$('again').addEventListener('click', startRun);
function toggleMute() {
  sound.init(); sound.setMuted(!sound.muted);
  const t = sound.muted ? '🔇' : '🔊';
  const m1 = $('mute'), m2 = $('mute2');
  if (m1) m1.textContent = t;
  if (m2) m2.textContent = sound.muted ? 'звук выкл' : 'звук';
}
$('mute').addEventListener('click', toggleMute);
$('mute2').addEventListener('click', toggleMute);
toggleMute(); sound.setMuted(sound.muted);

// ---------- динамическое разрешение ----------
let resScale = 1, fpsAvg = 60, resizeT = 0;
function applySize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.fov = w < h ? 74 : 58;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * resScale);
  renderer.setSize(w, h, false);
  fx.setScale(h * (devicePixelRatio || 1) * resScale * 0.5);
}
addEventListener('resize', applySize);
applySize();

// ---------- цикл ----------
let last = performance.now(), acc = 0;
const FIXED = 1 / 120;
let frames = 0, fpsT = performance.now();

function physics(dt) {
  player.update(dt, world, speed);
  for (const ev of player.events) {
    if (ev === 'jump') sound.jump();
    else if (ev === 'roll') sound.roll();
    else if (ev === 'land') sound.land();
    else if (ev === 'swipe') sound.swipe();
    else if (ev === 'bump') sound.bump();
  }
  player.events.length = 0;
  if (state !== 'run') return;

  dist = player.d;
  speed = Math.min(26, speed + 0.22 * dt);

  // столкновения
  if (invuln <= 0) {
    const h = world.hit(player.x, player.d, player.y, player.rolling);
    if (h) {
      if (shield > 0) { shield--; world.knock(h); sound.shield(); invuln = 0.6; fx.emit(h.x, 1.2, -h.d, 22, 0x3fc1ff, { spread: 4, up: 3, life: 0.5 }); setPowerUI(); }
      else die();
    }
  }
  invuln = Math.max(0, invuln - dt);

  // сбор
  world.collect(player.x, player.y, player.d, magnetT > 0, dt, out);
  if (out.coins) {
    coins += out.coins; score += out.coins * 10 * mult;
    sound.coin();
    fx.emit(player.x, player.y + 1.1, -player.d, out.coins * 3, 0xffc928, { spread: 1.6, up: 2.5, life: 0.4, size: 0.22 });
  }
  if (out.power) {
    sound.power();
    if (out.power === 'magnet') magnetT = 10;
    else if (out.power === 'shield') shield = Math.min(shield + 1, 3);
    else if (out.power === 'x2') { x2T = 12; mult = 2; multT = 12; }
    setPowerUI();
  }
  magnetT = Math.max(0, magnetT - dt); x2T = Math.max(0, x2T - dt);
  if (x2T <= 0 && mult !== 1) { mult = 1; setPowerUI(); }

  score += speed * dt * 0.8 * mult;

  // тряска
  shake = Math.max(0, shake - dt * 2.2);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  time += dt;

  // фиксированный физический шаг
  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < 12) { physics(FIXED); acc -= FIXED; steps++; }

  // биом/погода/сутки
  const { b, nb, t, idx } = world.biomeNow(dist);
  const mix = t > 0.8 ? (t - 0.8) / 0.2 : 0;
  const lerpC = (a, c) => new THREE.Color(a).lerp(new THREE.Color(c), mix);
  const skyTop = lerpC(b.sky, nb.sky), skyBot = lerpC(b.ground, nb.ground);
  const fogC = lerpC(b.fog, nb.fog);
  const nightT = THREE.MathUtils.lerp(b.night, nb.night, mix);
  const wT = (b.weather ? 1 : 0) * (1 - mix) + (nb.weather ? 1 : 0) * mix;
  const wType = b.weather && (b.weather === nb.weather || mix < 0.5) ? b.weather : nb.weather || b.weather;

  night += (nightT - night) * Math.min(1, dt * 1.2);
  weatherI += (wT - weatherI) * Math.min(1, dt * 0.8);
  cloud = 0.2 + weatherI * 0.65;
  tod = (0.18 + (1 - night) * 0.32 + 0.2) % 1;

  // изгиб мира в шейдере: поворот медленно меняется с дистанцией — то влево, то вправо
  U.uCurve.value.set((Math.sin(dist * 0.0052) * 0.65 + Math.sin(dist * 0.0021 + 1.7) * 0.35) * 0.0015, -0.00085 + 0.0003 * Math.sin(dist * 0.0031));
  U.uTime.value = time;
  U.uWx.value.set(wType === 'snow' ? weatherI : 0, wType === 'rain' ? weatherI : 0);

  scene.fog.color.copy(fogC);
  scene.fog.near = 55 - weatherI * 12;
  scene.fog.far = 190 - weatherI * 55;
  world.matGround.color.copy(lerpC(b.ground, nb.ground));
  world.matWall.color.copy(lerpC(b.wall, nb.wall));
  world.matRoad.emissive.copy(fogC).multiplyScalar(night * 0.12);

  // свет
  const dayF = 1 - night;
  hemi.intensity = 0.55 + dayF * 0.65;
  dir.intensity = 0.35 + dayF * 1.15;
  dir.color.setHex(night > 0.5 ? 0xbfd4ff : 0xfff2dc);
  hemi.color.copy(skyTop);

  // камера: прямая сцена (мир едет к камере), изгиб делает шейдер
  const px = player.x, py = player.y;
  _t.set(px * 0.72, 4.3 + py * 0.62, -dist + 7.4);
  _l.set(px * 0.86, 1.5 + py * 0.62, -dist - 9);
  const kx = Math.min(1, dt * 9), ky = Math.min(1, dt * 5), kz = Math.min(1, dt * 14);
  camPos.x += (_t.x - camPos.x) * kx; camPos.y += (_t.y - camPos.y) * ky; camPos.z += (_t.z - camPos.z) * kz;
  camLook.x += (_l.x - camLook.x) * kx; camLook.y += (_l.y - camLook.y) * ky; camLook.z += (_l.z - camLook.z) * kz;
  camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 1.2; camera.position.y += (Math.random() - 0.5) * shake * 1.2; }
  camera.lookAt(camLook);
  camera.rotation.z += shake * 0.02 * Math.sin(time * 40);

  dir.position.set(px + 8, 18, -14);
  dirT.position.set(px, 0, -14);

  sky.update(camera.position, tod, night, cloud);
  weather.update(dt, camera.position, wType, weatherI);
  sound.setAmbience(weatherI * (wType ? 1 : 0), weatherI * 0.6 + 0.15);

  world.update(dt, dist, speed, time, night);
  fx.update(dt);

  // динамическое разрешение под FPS
  frames++;
  if (now - fpsT > 500) {
    const fps = frames * 1000 / (now - fpsT);
    frames = 0; fpsT = now;
    fpsAvg += (fps - fpsAvg) * 0.5;
    if (showFps) hud.fps.textContent = Math.round(fpsAvg);
    resizeT -= 0.5;
    if (resizeT <= 0) {
      let ns = resScale;
      if (fpsAvg > 100 && resScale < 1) ns = Math.min(1, resScale + 0.1);
      else if (fpsAvg < 55 && resScale > 0.5) ns = Math.max(0.5, resScale - 0.1);
      else if (fpsAvg < 40 && resScale > 0.4) ns = 0.4;
      if (ns !== resScale) { resScale = ns; applySize(); resizeT = 2; }
    }
  }

  // HUD
  if (state === 'run') {
    hud.score.textContent = Math.floor(score);
    hud.coins.textContent = coins;
    hud.mult.textContent = mult > 1 ? '×2' : '';
  }

  renderer.render(scene, camera);
}

// меню: живой раннер на фоне
player.state = 'menu';
player.d = 0;
(function menuLoop() {
  if (state === 'menu') {
    player.animT += 0.016;
    player.update(0.016, world, 12);
  }
})();

requestAnimationFrame(frame);

// ---------- QA API ----------
window.gameApi = {
  start: startRun,
  godMode(on) { invuln = on ? 1e9 : 0; },
  skipToBiome(i) {
    dist = i * 420 + 60;
    player.d = dist;
    world.reset(i);
    player.d = dist;
  },
  state() {
    return { dist, score: Math.floor(score), coins, speed, night, weatherI, biome: world.biomeNow(dist).idx, state, resScale, fps: Math.round(fpsAvg), obs: world.obs.length, segs: world.chunks.length };
  },
};
