// Мир: прямая сцена (мир едет к камере), изгиб делает шейдер (curve.js).
// Пул чанков, пул препятствий, монеты одним InstancedMesh, генератор с проходимой полосой.
import * as THREE from 'three';
import { curved } from './curve.js';
import { roadTexture, facadeTexture, radialTexture } from './textures.js';

export const LW = 2.4;               // ширина полосы
export const ROAD_HALF = LW * 1.5 + 0.7;
export const CL = 48;                // длина чанка
const NCH = 9;                       // чанков: k = -1..NCH-2
const MAXC = 420;                    // пул монет
const TRAM_LEN = 10.5, TRAM_TOP = 2.55, RAMP_LEN = 7;

export const BIOMES = [
  { name: 'DAY',    sky: 0x8ec9ff, fog: 0xb6dcff, ground: 0x8fbf5a, wall: 0xb9a68d, night: 0,    weather: null },
  { name: 'SUNSET', sky: 0xffa25e, fog: 0xffc28a, ground: 0xb98a55, wall: 0xd9a06d, night: 0.25, weather: null },
  { name: 'NIGHT',  sky: 0x2c4260, fog: 0x46618a, ground: 0x56646e, wall: 0x5d6a80, night: 1,    weather: null },
  { name: 'RAIN',   sky: 0x7d97a8, fog: 0x9db6c4, ground: 0x77817f, wall: 0x8d949c, night: 0.35, weather: 'rain' },
  { name: 'SNOW',   sky: 0xd8ecff, fog: 0xc2dcf2, ground: 0xf2f6fa, wall: 0xaebccb, night: 0.15, weather: 'snow' },
];
export const BIOME_LEN = 420;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export class World {
  constructor(scene, rndSeed = 1) {
    this.scene = scene;
    this.rnd = mulberry32(rndSeed);
    const rnd = this.rnd;

    // ---- материалы чанков ----
    const roadTex = roadTexture();
    this.matRoad = curved(new THREE.MeshLambertMaterial({ map: roadTex }));
    this.matGround = curved(new THREE.MeshLambertMaterial({ color: 0x8fbf5a }));
    this.matWall = curved(new THREE.MeshLambertMaterial({ color: 0xb9a68d }));
    this.matKit = curved(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.matTow = curved(new THREE.MeshLambertMaterial({ color: 0x2f3a4a, emissive: 0xffc96a, emissiveIntensity: 0 }));
    this.glowTex = radialTexture(64, 'rgba(255,220,140,1)', 'rgba(255,220,140,0)');
    this.matGlow = curved(new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));

    // ---- геометрия чанка ----
    const roadGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, CL, 1, 10).rotateX(-Math.PI / 2);
    const groundGeo = new THREE.PlaneGeometry(64, CL, 1, 1).rotateX(-Math.PI / 2);
    const wallGeo = new THREE.PlaneGeometry(CL, 7, 10, 1).rotateY(Math.PI / 2);
    const lampGeo = new THREE.BoxGeometry(0.16, 4.6, 0.16);
    const lampHeadGeo = new THREE.BoxGeometry(0.5, 0.22, 0.5);

    this.chunks = [];
    for (let k = -1; k < NCH - 1; k++) {
      const grp = new THREE.Group();
      const ground = new THREE.Mesh(groundGeo, this.matGround); ground.position.y = -0.02; ground.frustumCulled = false;
      const road = new THREE.Mesh(roadGeo, this.matRoad); road.position.y = 0.01; road.frustumCulled = false;
      const wallL = new THREE.Mesh(wallGeo, this.matWall); wallL.position.set(-ROAD_HALF - 0.4, 3.5, 0); wallL.frustumCulled = false;
      const wallR = new THREE.Mesh(wallGeo, this.matWall); wallR.position.set(ROAD_HALF + 0.4, 3.5, 0); wallR.rotation.y = -Math.PI; wallR.frustumCulled = false;
      // дальние высотки (emissive-окна ночью)
      const tows = new THREE.Group();
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const h = 12 + rnd() * 22;
          const tw = new THREE.Mesh(new THREE.BoxGeometry(6 + rnd() * 5, h, 6 + rnd() * 5), this.matTow);
          tw.position.set(side * (13 + rnd() * 9), h / 2, -CL / 2 + (i + 0.5) * (CL / 3));
          tw.frustumCulled = false;
          tows.add(tw);
        }
      }
      // фонари
      const lamps = new THREE.Group();
      for (const side of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          const pole = new THREE.Mesh(lampGeo, this.matWall);
          pole.position.set(side * (ROAD_HALF + 0.5), 2.3, -CL / 2 + i * (CL / 2) + 6);
          const head = new THREE.Mesh(lampHeadGeo, this.matTow);
          head.position.set(side * (ROAD_HALF + 0.5), 4.7, -CL / 2 + i * (CL / 2) + 6);
          pole.frustumCulled = false; head.frustumCulled = false;
          lamps.add(pole, head);
        }
      }
      grp.add(ground, road, wallL, wallR, tows, lamps);
      grp.position.z = -k * CL;
      scene.add(grp);
      this.chunks.push({ k, grp, ground, road, wallL, wallR, tows, lamps });
    }

    // ---- препятствия: процедурные low-poly ----
    this.defs = {
      low:  { geo: new THREE.BoxGeometry(2.1, 1.1, 0.55), mat: this.matKit, len: 0.55, top: 1.1, kind: 'low', color: 0xff5252 },
      high: { geo: new THREE.BoxGeometry(2.1, 3.2, 0.5),  mat: this.matKit, len: 0.5,  top: 3.2, kind: 'high', color: 0xff8c42 },
      ramp: { geo: this._rampGeo(), mat: this.matKit, len: RAMP_LEN, top: TRAM_TOP, kind: 'ramp', color: 0xffc928 },
      tram: { geo: this._tramGeo(), mat: this.matKit, len: TRAM_LEN, top: TRAM_TOP, kind: 'plat', color: 0x4f8cff },
      car:  { geo: this._carGeo(),  mat: this.matKit, len: 4.6, top: 1.7, kind: 'plat', color: 0xe0e4ea },
    };
    this.pool = {}; this.obs = [];

    // ---- монеты: один InstancedMesh ----
    const cg = new THREE.CylinderGeometry(0.34, 0.34, 0.09, 14).rotateX(Math.PI / 2);
    this.coinMat = curved(new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x8a5a00 }), 'coin');
    this.coins = new THREE.InstancedMesh(cg, this.coinMat, MAXC);
    this.coins.frustumCulled = false;
    this.cx = new Float32Array(MAXC); this.cy = new Float32Array(MAXC); this.cd = new Float32Array(MAXC);
    this.cAlive = new Uint8Array(MAXC); this.cPtr = 0;
    this.coins.instanceMatrix.array.fill(0);
    scene.add(this.coins);

    // ---- бонусы ----
    this.powerDefs = { magnet: 0xff4d6d, shield: 0x3fc1ff, x2: 0xb56bff };
    this.powers = []; this.powerPool = [];
    this.powerGeo = new THREE.OctahedronGeometry(0.6, 0);
    this.haloMat = curved(new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));

    this.reset(0);
  }

  _rampGeo() {
    const g = new THREE.BufferGeometry();
    const L = RAMP_LEN, W = 2.1, H = TRAM_TOP;
    const v = new Float32Array([
      -W/2,0,-L/2,  W/2,0,-L/2,  W/2,H,L/2,  -W/2,H,L/2,   // верх
      -W/2,0,-L/2,  -W/2,H,L/2,  -W/2,0,L/2,                 // борта
       W/2,0,-L/2,   W/2,0,L/2,   W/2,H,L/2,
      -W/2,0,-L/2,  -W/2,0,L/2,   W/2,0,L/2,                 // низ
      -W/2,0,-L/2,   W/2,0,L/2,   W/2,0,-L/2,
      -W/2,H,L/2,   W/2,H,L/2,    W/2,0,L/2, -W/2,H,L/2,    W/2,0,L/2, -W/2,0,L/2, // задняя стенка
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }
  _tramGeo() {
    const parts = [];
    const body = new THREE.BoxGeometry(2.2, TRAM_TOP, TRAM_LEN); body.translate(0, TRAM_TOP / 2, 0); parts.push(body);
    const roof = new THREE.BoxGeometry(2.3, 0.18, TRAM_LEN - 0.6); roof.translate(0, TRAM_TOP + 0.09, 0); parts.push(roof);
    for (const s of [-1, 1]) for (const z of [-TRAM_LEN/2 + 1.2, TRAM_LEN/2 - 1.2]) {
      const w = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10); w.rotateZ(Math.PI / 2); w.translate(s * 1.05, 0.42, z); parts.push(w);
    }
    return this._merge(parts);
  }
  _carGeo() {
    const parts = [];
    const body = new THREE.BoxGeometry(2.0, 1.1, 4.4); body.translate(0, 0.75, 0); parts.push(body);
    const top = new THREE.BoxGeometry(1.7, 0.65, 2.2); top.translate(0, 1.6, -0.2); parts.push(top);
    for (const s of [-1, 1]) for (const z of [-1.5, 1.5]) {
      const w = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 10); w.rotateZ(Math.PI / 2); w.translate(s * 0.95, 0.4, z); parts.push(w);
    }
    return this._merge(parts);
  }
  _merge(parts) {
    // простой merge position/normal/uv без BufferGeometryUtils
    let pos = [], norm = [], idx = [], off = 0;
    for (const g of parts) {
      const p = g.attributes.position, n = g.attributes.normal, ix = g.index ? g.index.array : null;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); norm.push(n.getX(i), n.getY(i), n.getZ(i)); }
      if (ix) for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
      off += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    out.setIndex(idx);
    return out;
  }

  // ---- чанки ----
  setChunk(c, k) { c.k = k; c.grp.position.z = -k * CL; }

  reset(startBiome = 0) {
    this.startBiome = startBiome;
    this.chunks.forEach((c, i) => this.setChunk(c, i - 1));
    this.maxK = NCH - 2;
    for (const o of this.obs) this.release(o);
    this.obs.length = 0;
    this.cAlive.fill(0); this.coins.instanceMatrix.array.fill(0); this.coins.instanceMatrix.needsUpdate = true;
    for (const p of this.powers) { p.mesh.visible = false; this.powerPool.push(p.mesh); }
    this.powers.length = 0;
    this.genD = 70; this.prevD = 40; this.safe = 1; this.busy = [0, 0, 0];
    this.nextPower = 260; this.speed = 12;
    this.coinsDirty = true;
  }

  // ---- пул препятствий ----
  spawn(type, lane, d, mv = 0, ref = d) {
    const def = this.defs[type];
    let m = (this.pool[type] ||= []).pop();
    if (!m) { m = new THREE.Mesh(def.geo, this.matKit.clone()); m.material.color.set(def.color); m.frustumCulled = false; this.scene.add(m); }
    m.visible = true;
    const o = { type, lane, x: (lane - 1) * LW, d0: d, d, len: def.len, top: def.top, kind: def.kind, mesh: m, mv, ref };
    m.position.set(o.x, 0, -d); m.rotation.set(0, 0, 0); m.scale.setScalar(1);
    if (def.kind === 'plat' && type === 'car' && !mv && this.rnd() < 0.5) m.rotation.y = Math.PI;
    this.obs.push(o);
    return o;
  }
  release(o) { o.mesh.visible = false; this.pool[o.type].push(o.mesh); }

  addCoin(lane, d, y) {
    for (let n = 0; n < MAXC; n++) {
      const i = (this.cPtr + n) % MAXC;
      if (this.cAlive[i]) continue;
      this.cPtr = i + 1;
      this.cAlive[i] = 1; this.cx[i] = (lane - 1) * LW; this.cy[i] = y; this.cd[i] = d;
      this.writeCoin(i, 1);
      return;
    }
  }
  writeCoin(i, s) {
    const a = this.coins.instanceMatrix.array, o = i * 16;
    a[o] = a[o + 5] = a[o + 10] = s; a[o + 15] = 1;
    a[o + 12] = this.cx[i]; a[o + 13] = this.cy[i]; a[o + 14] = -this.cd[i];
    this.coinsDirty = true;
  }
  addPower(lane, d) {
    const type = ['magnet', 'shield', 'x2'][Math.floor(this.rnd() * 3)];
    let m = this.powerPool.pop();
    if (!m) {
      m = new THREE.Mesh(this.powerGeo, curved(new THREE.MeshLambertMaterial({ emissiveIntensity: 0.7 })));
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.haloMat.clone());
      halo.material.onBeforeCompile = this.haloMat.onBeforeCompile; halo.material.customProgramCacheKey = this.haloMat.customProgramCacheKey;
      halo.scale.setScalar(3.4); m.add(halo); m.userData.halo = halo; m.frustumCulled = halo.frustumCulled = false;
      this.scene.add(m);
    }
    m.material.color.set(this.powerDefs[type]); m.material.emissive.set(this.powerDefs[type]);
    m.userData.halo.material.color.set(this.powerDefs[type]);
    m.visible = true; m.position.set((lane - 1) * LW, 1.4, -d);
    this.powers.push({ type, x: (lane - 1) * LW, d, mesh: m });
  }

  // ---- генератор: всегда есть проходимая «безопасная» полоса ----
  genRow() {
    const r = this.rnd, d = this.genD, prevD = this.prevD;
    const diff = Math.min(1, Math.max(0, (d - 150) / 3000));
    const freeGap = (l) => this.busy[l] <= prevD + 3;
    const cand = [this.safe];
    for (const dir of [-1, 1]) {
      const l = this.safe + dir;
      if (l < 0 || l > 2 || !freeGap(l)) continue;
      cand.push(l, l);
      const l2 = l + dir;
      if (l2 >= 0 && l2 <= 2 && freeGap(l2) && r() < 0.35) cand.push(l2);
    }
    const safe = cand[Math.floor(r() * cand.length)];
    let safeItem = 'none';
    const airHalf = Math.min(9, this.speed * 0.3);

    for (let l = 0; l < 3; l++) {
      if (this.busy[l] > d - 1) continue;
      const x = r();
      if (l === safe) {
        const pe = 0.45 - diff * 0.2;
        if (x < pe) safeItem = 'none';
        else if (x < pe + (1 - pe) * 0.55) { this.spawn('low', l, d); safeItem = 'low'; }
        else { this.spawn('high', l, d); safeItem = 'high'; }
        continue;
      }
      const pe = 0.3 - diff * 0.18;
      if (x < pe) continue;
      const y = (x - pe) / (1 - pe);
      if (y < 0.2) this.spawn('low', l, d);
      else if (y < 0.4) this.spawn('high', l, d);
      else if (y < 0.68) {
        const mv = diff > 0.08 && r() < 0.3 ? 0.5 : 0;
        this.spawn('car', l, d + 2.3, mv, d);
      } else {
        const n = 1 + (r() < 0.5 ? 1 : 0) + (diff > 0.3 && r() < 0.3 ? 1 : 0);
        const ramp = r() < 0.4, mv = !ramp && diff > 0.1 && r() < 0.35 ? 0.5 : 0;
        let s = d;
        if (ramp) { this.spawn('ramp', l, s + RAMP_LEN / 2); s += RAMP_LEN; }
        const s0 = s;
        for (let k = 0; k < n; k++) { this.spawn('tram', l, s + TRAM_LEN / 2, mv, d); s += TRAM_LEN + 0.5; }
        this.busy[l] = s + (ramp ? 20 : 2);
        if (ramp) for (let cd = s0 + 2; cd < s - 2; cd += 2.6) this.addCoin(l, cd, TRAM_TOP + 0.95);
      }
    }

    if (d > this.nextPower) {
      this.addPower(safe, (prevD + d) / 2 + 2);
      this.nextPower = d + 300 + r() * 240;
    } else if (r() < 0.72) {
      for (let cd = prevD + 6; cd < d - (safeItem === 'low' ? airHalf : 2.5); cd += 2.5) this.addCoin(safe, cd, 0.95);
      if (safeItem === 'low') for (let k = -2; k <= 2; k++) { const t = k / 2.4; this.addCoin(safe, d + t * airHalf, 0.95 + 2.1 * (1 - t * t)); }
      if (safeItem === 'high') for (let k = -1; k <= 1; k++) this.addCoin(safe, d + k * 2.5, 0.55);
    }
    this.prevD = d; this.safe = safe;
    this.genD = d + Math.max(15, this.speed * 0.66) + r() * (9 - diff * 5) + (1 - diff) * 5;
  }

  // ---- запросы для игрока ----
  topAt(o, d) {
    if (o.kind === 'ramp') return o.top * Math.min(1, Math.max(0, (d - (o.d - o.len / 2)) / o.len));
    return o.top;
  }
  groundAt(x, d, y) {
    let g = 0;
    for (const o of this.obs) {
      if (o.kind !== 'plat' && o.kind !== 'ramp') continue;
      if (Math.abs(o.x - x) > 1.25 || d < o.d - o.len / 2 - 0.2 || d > o.d + o.len / 2 + 0.2) continue;
      const t = this.topAt(o, d);
      if (y >= t - 0.45 && t > g) g = t;
    }
    return g;
  }
  blocked(x, d0, d1, y) {
    for (const o of this.obs) {
      if (o.kind !== 'plat' && o.kind !== 'ramp') continue;
      if (Math.abs(o.x - x) > 1.0 || d1 < o.d - o.len / 2 || d0 > o.d + o.len / 2) continue;
      if (y < this.topAt(o, Math.min(d1, o.d + o.len / 2)) - 0.45) return true;
    }
    return false;
  }
  hit(x, d, y, rolling) {
    for (const o of this.obs) {
      if (Math.abs(o.x - x) > 1.0) continue;
      const h = o.len / 2;
      if (o.kind === 'low') { if (Math.abs(d - o.d) < 0.55 && y < o.top - 0.2) return o; }
      else if (o.kind === 'high') { if (Math.abs(d - o.d) < 0.5 && y < 2.3 && !(rolling && y < 0.6)) return o; }
      else if (d > o.d - h - 0.35 && d < o.d + h && y < this.topAt(o, d) - 0.45) return o;
    }
    return null;
  }
  knock(o) {
    const i = this.obs.indexOf(o);
    if (i >= 0) { this.release(o); this.obs.splice(i, 1); }
  }

  collect(px, py, pd, magnet, dt, out) {
    out.coins = 0; out.power = null;
    for (let i = 0; i < MAXC; i++) {
      if (!this.cAlive[i]) continue;
      const dd = this.cd[i] - pd;
      if (dd < -9) { this.cAlive[i] = 0; this.writeCoin(i, 0); continue; }
      if (dd > 26) continue;
      if (magnet && dd < 16 && dd > -3) {
        const k = Math.min(1, dt * 11);
        this.cx[i] += (px - this.cx[i]) * k; this.cy[i] += (py + 0.9 - this.cy[i]) * k; this.cd[i] += (pd - this.cd[i]) * k * 0.9;
        this.writeCoin(i, 1);
      }
      if (Math.abs(this.cd[i] - pd) < 1.0 && Math.abs(this.cx[i] - px) < 1.0 && Math.abs(this.cy[i] - (py + 0.9)) < 1.35) {
        this.cAlive[i] = 0; this.writeCoin(i, 0); out.coins++;
      }
    }
    for (let i = this.powers.length - 1; i >= 0; i--) {
      const p = this.powers[i];
      const got = Math.abs(p.d - pd) < 1.2 && Math.abs(p.x - px) < 1.1 && py < 3;
      if (got || p.d < pd - 9) {
        if (got) out.power = p.type;
        p.mesh.visible = false; this.powerPool.push(p.mesh); this.powers.splice(i, 1);
      }
    }
    return out;
  }

  biomeNow(pd) {
    const total = BIOME_LEN;
    const idx = Math.floor(pd / total) % BIOMES.length;
    const t = (pd % total) / total;
    const b = BIOMES[idx], nb = BIOMES[(idx + 1) % BIOMES.length];
    return { b, nb, t, idx };
  }

  update(dt, pd, speed, time, night) {
    this.speed = speed;
    for (const c of this.chunks) if ((c.k + 1) * CL < pd - 16) this.setChunk(c, ++this.maxK);
    while (this.genD < pd + 235) this.genRow();
    for (let i = this.obs.length - 1; i >= 0; i--) {
      const o = this.obs[i];
      if (o.mv) { o.d = o.d0 + o.mv * Math.max(0, o.ref - pd - 5); o.mesh.position.z = -o.d; }
      if (o.d + o.len / 2 < pd - 12) { this.release(o); this.obs.splice(i, 1); }
    }
    for (const p of this.powers) { p.mesh.rotation.y = time * 2.2; p.mesh.position.y = 1.4 + Math.sin(time * 3 + p.d) * 0.18; p.mesh.userData.halo.rotation.y = -time * 2.2; }
    if (this.coinsDirty) { this.coins.instanceMatrix.needsUpdate = true; this.coinsDirty = false; }
    // ночные огня: окна высоток и фонари
    this.matTow.emissiveIntensity = night * 1.15;
    this.matGlow.opacity = night * 0.85;
  }
}
