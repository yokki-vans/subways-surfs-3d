// Частицы: искры монет, пыль, обломки. Один Points на всё (по мотивам sprint-city-3d).
import * as THREE from 'three';

const N = 360;
const VS = `attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vCol;
void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.5, -mv.z); }`;
const FS = `varying vec4 vCol; void main(){ float r = length(gl_PointCoord - 0.5); float a = (1.0 - smoothstep(0.2, 0.5, r)) * vCol.a; if (a < 0.01) discard; gl_FragColor = vec4(vCol.rgb, a); }`;

export class Fx {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 4); this.size = new Float32Array(N);
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.grav = new Float32Array(N); this.s0 = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.u = { uScale: { value: 600 } };
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false }));
    this.pts.frustumCulled = false; this.pts.renderOrder = 15;
    scene.add(this.pts);
    this.ptr = 0; this.c = new THREE.Color();
  }
  setScale(h) { this.u.uScale.value = h; }
  emit(x, y, z, n, color, o = {}) {
    const { spread = 3, up = 3, grav = -9, life = 0.5, size = 0.35, vz = 0 } = o;
    this.c.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.ptr = (this.ptr + 1) % N;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, s = spread * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = Math.cos(a) * s; this.vel[i * 3 + 1] = up * (0.3 + Math.random()); this.vel[i * 3 + 2] = Math.sin(a) * s * 0.6 + vz;
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.6); this.grav[i] = grav; this.s0[i] = size * (0.6 + Math.random() * 0.7);
      this.col[i * 4] = this.c.r; this.col[i * 4 + 1] = this.c.g; this.col[i * 4 + 2] = this.c.b;
    }
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.size[i] = 0; any = true; } continue; }
      any = true;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.max[i]);
      this.col[i * 4 + 3] = t; this.size[i] = this.s0[i] * (0.5 + 0.5 * t);
    }
    if (any) { const a = this.pts.geometry.attributes; a.position.needsUpdate = a.aCol.needsUpdate = a.aSize.needsUpdate = true; }
  }
}
