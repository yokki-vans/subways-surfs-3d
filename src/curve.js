// Изгиб мира: сдвиг вершин в пространстве камеры пропорционально квадрату дальности.
// Даёт плавный радиальный поворот трассы и «горизонт-холм» без единого угла.
import * as THREE from 'three';

export const U = {
  uCurve: { value: new THREE.Vector2(0, 0) }, // x — поворот влево/вправо, y — уход вниз
  uWx: { value: new THREE.Vector2(0, 0) },    // x — снег, y — мокрый асфальт
  uTime: { value: 0 },
};

const BEND = `#include <project_vertex>
  mvPosition.xy += uCurve * mvPosition.z * mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;`;

// mode: '' — только изгиб; 'wx' — ещё снег/дождь на горизонтальных гранях; 'coin' — вращение инстансов
export function curved(mat, mode = '') {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCurve = U.uCurve;
    let vs = 'uniform vec2 uCurve;\n' + sh.vertexShader.replace('#include <project_vertex>', BEND);
    if (mode === 'wx') {
      sh.uniforms.uWx = U.uWx;
      vs = 'varying float vUpN;\n' + vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vUpN = objectNormal.y;');
      sh.fragmentShader = 'uniform vec2 uWx;\nvarying float vUpN;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float upK = smoothstep(0.55, 0.9, vUpN);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 1.0), uWx.x * upK * 0.66);
        diffuseColor.rgb *= 1.0 - 0.32 * uWx.y * upK;`);
    }
    if (mode === 'coin') {
      sh.uniforms.uTime = U.uTime;
      vs = 'uniform float uTime;\n' + vs
        .replace('#include <beginnormal_vertex>', `float cA = uTime * 3.2 + instanceMatrix[3].z * 0.4;
          mat2 cR = mat2(cos(cA), -sin(cA), sin(cA), cos(cA));
          #include <beginnormal_vertex>
          objectNormal.xz = cR * objectNormal.xz;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.xz = cR * transformed.xz;');
    }
    sh.vertexShader = vs;
  };
  mat.customProgramCacheKey = () => 'curved-' + mode;
  return mat;
}
