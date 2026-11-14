// Небо: шейдерный фон (градиент + солнце/луна + облака), звёзды, осадки в шейдере.
import * as THREE from 'three';

const skyVS = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const skyFS = `
varying vec3 vDir;
uniform vec3 uTop, uBot, uSun, uSunCol;
uniform float uNight, uCloud;
float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.1; a*=0.5;} return v; }
void main(){
  vec3 d = normalize(vDir);
  float t = clamp(d.y*1.6+0.45, 0.0, 1.0);
  vec3 col = mix(uBot, uTop, pow(t,0.7));
  // солнце/луна
  float sd = max(dot(d, normalize(uSun)), 0.0);
  float disc = smoothstep(0.9985, 0.9997, sd);
  float glow = pow(sd, 40.0) * 0.55 + pow(sd, 6.0) * 0.18;
  col += uSunCol * (disc * 1.2 + glow);
  // звёзды ночью
  if (uNight > 0.02 && d.y > -0.05) {
    vec2 sp = floor(d.xy * 220.0 + d.z * 90.0);
    float s = h(sp);
    if (s > 0.988) { float tw = 0.5 + 0.5*sin(s*90.0); col += vec3(0.9,0.95,1.0) * uNight * tw * smoothstep(0.0,0.3,d.y); }
  }
  // облака
  if (uCloud > 0.02 && d.y > 0.02) {
    vec2 cp = d.xz / (d.y + 0.35) * 2.2;
    float c = fbm(cp);
    c = smoothstep(0.48, 0.78, c) * uCloud * smoothstep(0.02, 0.35, d.y);
    vec3 cc = mix(vec3(0.35,0.4,0.5), vec3(1.0), 1.0 - uNight);
    col = mix(col, cc, c * 0.75);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.sunDir = new THREE.Vector3(-0.4, 0.55, -1);
    this.u = {
      uTop: { value: new THREE.Color(0x4f9fe8) },
      uBot: { value: new THREE.Color(0xb6dcff) },
      uSun: { value: this.sunDir },
      uSunCol: { value: new THREE.Color(0xfff2c0) },
      uNight: { value: 0 },
      uCloud: { value: 0.25 },
    };
    const geo = new THREE.SphereGeometry(480, 24, 16);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: skyVS, fragmentShader: skyFS, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  update(camPos, tod, night, cloud) {
    this.mesh.position.copy(camPos);
    // tod: 0..1 сутки. Солнце по дуге.
    const ang = tod * Math.PI * 2 - Math.PI / 2;
    this.sunDir.set(Math.cos(ang) * 0.55, Math.sin(ang), -0.85).normalize();
    this.u.uNight.value = night;
    this.u.uCloud.value = cloud;
    this.u.uSunCol.value.setHex(night > 0.5 ? 0xbfd4ff : 0xfff2c0);
  }
}

// Осадки: GPU-частицы, обёрнуты вокруг камеры (циклические координаты).
const rainVS = `
attribute float aOff;
uniform float uTime, uH;
varying float vA;
void main(){
  vec3 p = position;
  float y = mod(p.y - uTime * (p.x*0.0+18.0) * (1.0 + aOff), uH);
  p.y = y - uH * 0.5;
  p.x += sin(uTime * 0.7 + aOff * 6.28) * 0.6; // ветер
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = mix(1.5, 4.0, aOff) * (300.0 / max(1.0, -mv.z));
  vA = 1.0;
}`;
const rainFS = `
uniform vec3 uCol; uniform float uOpacity;
varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.15, 0.5, length(q))) * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uCol, a);
}`;

export class Weather {
  constructor(scene) {
    const N = 900, H = 40;
    const pos = new Float32Array(N * 3), off = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
      off[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(off, 1));
    this.u = { uTime: { value: 0 }, uH: { value: H }, uCol: { value: new THREE.Color(0xd8efff) }, uOpacity: { value: 0 } };
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: rainVS, fragmentShader: rainFS, transparent: true, depthWrite: false, fog: false,
    }));
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 12;
    scene.add(this.pts);
    this.t = 0;
  }
  update(dt, camPos, type, intensity) {
    this.t += dt;
    this.pts.position.copy(camPos);
    this.pts.position.y += 12;
    this.u.uTime.value = this.t * (type === 'snow' ? 0.25 : 1.0);
    this.u.uCol.value.setHex(type === 'snow' ? 0xffffff : 0xd8efff);
    this.u.uOpacity.value = intensity * (type === 'snow' ? 0.9 : 0.55);
  }
}
