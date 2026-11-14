// Игрок: полосы, прыжок, перекат, процедурная анимация (без GLB-скелета).
import * as THREE from 'three';
import { curved } from './curve.js';
import { radialTexture } from './textures.js';
import { LW } from './world.js';

const GRAV = -52, JUMP = 16.8, ROLL_T = 0.62, LANE_SPEED = 17;

export class Player {
  constructor(scene) {
    this.root = new THREE.Group();
    this.spin = new THREE.Group();
    this.spin.position.y = 0.9;
    this.holder = new THREE.Group();
    this.holder.position.y = -0.9;
    this.spin.add(this.holder); this.root.add(this.spin); scene.add(this.root);

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2),
      curved(new THREE.MeshBasicMaterial({ map: radialTexture(64, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)'), transparent: true, opacity: 0.5, depthWrite: false })));
    this.shadow.renderOrder = 2;
    scene.add(this.shadow);

    this.shieldFx = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1),
      new THREE.MeshBasicMaterial({ color: 0x3fc1ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.shieldFx.position.y = 0.95; this.shieldFx.visible = false; this.root.add(this.shieldFx);

    this.body = this._buildRunner();
    this.holder.add(this.body);
    this.reset();
  }

  _buildRunner() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xe8b28a });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x3aa0ff });
    const pants = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
    const shoe = new THREE.MeshLambertMaterial({ color: 0xf5f5f0 });
    const cap = new THREE.MeshLambertMaterial({ color: 0xff5252 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), shirt); torso.position.y = 1.12;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.4), skin); head.position.y = 1.72;
    const capM = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.48), cap); capM.position.y = 1.94;
    const hip = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.24, 0.34), pants); hip.position.y = 0.74;

    const mkLimb = (mat, w, l1, l2) => {
      const upper = new THREE.Group();
      const u = new THREE.Mesh(new THREE.BoxGeometry(w, l1, w), mat); u.position.y = -l1 / 2; upper.add(u);
      const lower = new THREE.Group(); lower.position.y = -l1;
      const d = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, l2, w * 0.85), mat); d.position.y = -l2 / 2; lower.add(d);
      upper.add(lower);
      return { upper, lower, foot: lower };
    };
    const armL = mkLimb(shirt, 0.17, 0.42, 0.4); armL.upper.position.set(-0.42, 1.42, 0);
    const armR = mkLimb(shirt, 0.17, 0.42, 0.4); armR.upper.position.set(0.42, 1.42, 0);
    const legL = mkLimb(pants, 0.2, 0.44, 0.42); legL.upper.position.set(-0.17, 0.68, 0);
    const legR = mkLimb(pants, 0.2, 0.44, 0.42); legR.upper.position.set(0.17, 0.68, 0);
    for (const leg of [legL, legR]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.34), shoe); s.position.set(0, -0.42 - 0.06, 0.06);
      leg.foot.add(s);
    }
    g.add(torso, head, capM, hip, armL.upper, armR.upper, legL.upper, legR.upper);
    g.userData = { armL, armR, legL, legR, torso, head };
    for (const o of g.children) o.frustumCulled = false;
    return g;
  }

  reset() {
    this.lane = 1; this.x = 0; this.y = 0; this.vy = 0; this.d = 0;
    this.grounded = true; this.rollT = 0; this.bumpT = 0; this.bumpDir = 0; this.jumpBuf = 0; this.coyote = 0; this.rollQueued = false;
    this.state = 'menu'; this.airT = 0; this.animT = 0;
    this.spin.rotation.set(0, 0, 0); this.spin.scale.setScalar(1); this.spin.position.y = 0.9;
    this.root.rotation.set(0, 0, 0);
  }
  start() { this.state = 'run'; }

  get rolling() { return this.rollT > 0; }

  input(cmd, world) {
    if (this.state !== 'run') return;
    if (cmd === 'L' || cmd === 'R') {
      const dir = cmd === 'L' ? -1 : 1, nl = this.lane + dir;
      if (nl < 0 || nl > 2 || world.blocked((nl - 1) * LW, this.d - 0.7, this.d + 2.2, this.y)) {
        this.bumpT = 0.22; this.bumpDir = dir; this.events.push('bump');
      } else { this.lane = nl; this.events.push('swipe'); }
    } else if (cmd === 'U') {
      this.jumpBuf = 0.14;
    } else if (cmd === 'D') {
      if (this.grounded) this.startRoll(); else { this.vy = Math.min(this.vy, -30); this.rollQueued = true; }
    }
  }
  startRoll() { this.rollT = ROLL_T; this.events.push('roll'); }

  _animate(dt, speed) {
    const u = this.body.userData;
    if (this.rollT > 0) return; // кувырок — тело крутится через spin
    if (this.state === 'menu') {
      // лёгкое дыхание
      const b = Math.sin(this.animT * 2.2) * 0.06;
      u.torso.position.y = 1.12 + b * 0.3;
      u.armL.upper.rotation.x = b; u.armR.upper.rotation.x = -b;
      u.legL.upper.rotation.x = -b * 0.5; u.legR.upper.rotation.x = b * 0.5;
      return;
    }
    if (!this.grounded) {
      // в воздухе: поджатые ноги, руки вверх
      u.legL.upper.rotation.x = -0.9; u.legR.upper.rotation.x = -0.5;
      u.legL.lower.rotation.x = 0.9; u.legR.lower.rotation.x = 0.6;
      u.armL.upper.rotation.x = -2.2; u.armR.upper.rotation.x = -2.0;
      return;
    }
    // бег: частота зависит от скорости
    const w = 6 + speed * 0.55;
    const s = Math.sin(this.animT * w);
    const c = Math.sin(this.animT * w * 2);
    u.legL.upper.rotation.x = s * 1.05;
    u.legR.upper.rotation.x = -s * 1.05;
    u.legL.lower.rotation.x = Math.max(0, -s) * 0.9 + 0.1;
    u.legR.lower.rotation.x = Math.max(0, s) * 0.9 + 0.1;
    u.armL.upper.rotation.x = -s * 0.95;
    u.armR.upper.rotation.x = s * 0.95;
    u.armL.lower.rotation.x = -0.5 - c * 0.2;
    u.armR.lower.rotation.x = -0.5 + c * 0.2;
    u.torso.position.y = 1.12 + Math.abs(c) * 0.05;
    u.head.position.y = 1.72 + Math.abs(c) * 0.05;
  }

  update(dt, world, speed) {
    this.animT += dt;
    this._animate(dt, speed);
    const sh = this.shadow;
    if (this.state === 'menu') {
      this.root.position.set(this.x, this.y, -this.d);
      sh.position.set(this.x, 0.05, -this.d); sh.scale.setScalar(1);
      return;
    }
    if (this.state === 'dead') {
      this.vy += GRAV * dt; this.y = Math.max(this.deadGround, this.y + this.vy * dt);
      this.d -= this.kb * dt; this.kb *= Math.exp(-dt * 5);
      this.root.position.set(this.x, this.y, -this.d);
      sh.position.set(this.x, this.deadGround + 0.05, -this.d);
      return;
    }

    this.d += speed * dt;
    const tx = (this.lane - 1) * LW, dx = tx - this.x, step = LANE_SPEED * dt;
    this.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
    this.bumpT = Math.max(0, this.bumpT - dt);
    const bump = this.bumpT > 0 ? Math.sin((this.bumpT / 0.22) * Math.PI) * 0.45 * this.bumpDir : 0;

    const g = world.groundAt(this.x, this.d, this.y);
    this.jumpBuf -= dt; this.coyote -= dt;
    if (this.grounded) {
      if (g < this.y - 0.5) { this.grounded = false; this.coyote = 0.09; }
      else { this.y = g; this.vy = 0; }
    }
    if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = JUMP; this.grounded = false; this.jumpBuf = 0; this.coyote = 0; this.rollT = 0; this.rollQueued = false; this.airT = 0;
      this.events.push('jump');
    }
    if (!this.grounded) {
      this.airT += dt;
      this.vy += GRAV * dt; this.y += this.vy * dt;
      if (this.vy <= 0 && this.y <= g) {
        this.y = g; this.vy = 0; this.grounded = true; this.events.push('land');
        if (this.rollQueued) { this.rollQueued = false; this.startRoll(); }
      }
    }

    if (this.rollT > 0) {
      this.rollT -= dt;
      const t = 1 - Math.max(0, this.rollT) / ROLL_T;
      this.spin.rotation.x = -Math.PI * 2 * t;
      const sq = 0.62 + 0.38 * Math.pow(Math.abs(2 * t - 1), 3);
      this.spin.scale.setScalar(sq); this.spin.position.y = 0.9 * sq * 0.78;
      if (this.rollT <= 0) { this.spin.rotation.x = 0; this.spin.scale.setScalar(1); this.spin.position.y = 0.9; }
    }

    this.root.position.set(this.x + bump, this.y, -this.d);
    this.root.rotation.z = -dx * 0.09 - bump * 0.3;
    this.root.rotation.y = -dx * 0.16;

    const hgt = this.y - g;
    sh.position.set(this.x + bump, g + 0.05, -this.d);
    sh.scale.setScalar(Math.max(0.35, 1 - hgt * 0.22));
    sh.material.opacity = 0.5 * Math.max(0.3, 1 - hgt * 0.2);
  }

  die(world) {
    this.state = 'dead'; this.kb = 9; this.vy = 6;
    this.deadGround = world.groundAt(this.x, this.d - 1.2, 0.5);
    this.rollT = 0; this.spin.rotation.x = 0; this.spin.scale.setScalar(1); this.spin.position.y = 0.9;
    this.root.rotation.set(0, 0, 0);
  }
}
