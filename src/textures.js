// Тайлы дороги/тротуаров/фасадов и радиальные пятна (по мотивам sprint-city-3d).
import * as THREE from 'three';

export function roadTexture() {
  const W = 256, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3f46'; g.fillRect(0, 0, W, H);
  // асфальтная зернистость
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${190 + Math.random() * 40 | 0},${195 + Math.random() * 40 | 0},${200 + Math.random() * 40 | 0},${Math.random() * .06})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  // тротуары по бокам
  g.fillStyle = '#8d9299'; g.fillRect(0, 0, 34, H); g.fillRect(W - 34, 0, 34, H);
  g.fillStyle = 'rgba(0,0,0,.18)';
  for (let y = 0; y < H; y += 64) { g.fillRect(0, y, 34, 3); g.fillRect(W - 34, y, 34, 3); }
  for (let x = 34; x < W - 34; x += 74) { g.fillRect(x, 0, 2, H); }
  // бордюр
  g.fillStyle = '#c9cdd2'; g.fillRect(34, 0, 5, H); g.fillRect(W - 39, 0, 5, H);
  // разделительные полосы (2 шт на 3 полосы)
  g.fillStyle = 'rgba(245,245,235,.85)';
  for (let y = 0; y < H; y += 96) {
    g.fillRect(W * .333 - 3, y, 6, 48);
    g.fillRect(W * .666 - 3, y, 6, 48);
  }
  // сплошные края проезжей части
  g.fillStyle = 'rgba(255,255,255,.35)';
  g.fillRect(45, 0, 3, H); g.fillRect(W - 48, 0, 3, H);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function facadeTexture(base, accent, rnd) {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const N = 6, cs = S / N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    g.fillStyle = rnd() < .5 ? accent : 'rgba(0,0,0,.25)';
    g.fillRect(x * cs + 4, y * cs + 5, cs - 8, cs - 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function radialTexture(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.45)'));
  gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
