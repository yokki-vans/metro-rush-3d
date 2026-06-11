// Curved-world: every material gets a vertex-shader patch that bends geometry
// in view space by distance² — the track visually sweeps around a corner
// (and dips below the horizon) while gameplay stays straight.
import * as THREE from 'three';

export const curveUniform = { value: new THREE.Vector2(0.0012, -0.00045) }; // x: sideways, y: vertical
export const wobbleTime = { value: 0 };       // время для «желе»-колыхания
export const wobbleAmp = { value: 0.045 };    // амплитуда мультяшной нестрогости

const INJECT = `
  {
    float curveZZ = mvPosition.z * mvPosition.z;
    mvPosition.x += uCurveAmt.x * curveZZ;
    mvPosition.y += uCurveAmt.y * curveZZ;
    // мультяшное «желе»: лёгкая пространственная волна, чтобы геометрия не была строгой
    float wph = mvPosition.x * 0.9 + mvPosition.z * 1.6 + mvPosition.y * 0.7;
    mvPosition.x += sin(wph + uWobbleT * 1.7) * uWobbleA;
    mvPosition.y += cos(wph * 0.8 + uWobbleT * 1.3) * uWobbleA * 0.7;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export function curved(mat) {
  if (mat.userData.__curved) return mat;   // idempotent: shared materials get patched once
  mat.userData.__curved = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uCurveAmt = curveUniform;
    shader.uniforms.uWobbleT = wobbleTime;
    shader.uniforms.uWobbleA = wobbleAmp;
    shader.vertexShader = 'uniform vec2 uCurveAmt;\nuniform float uWobbleT;\nuniform float uWobbleA;\n'
      + shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n' + INJECT
      );
  };
  // make material cache key unique so three doesn't share an unpatched program
  mat.customProgramCacheKey = () => 'curved' + (mat.map ? 'm' : '') + mat.type;
  return mat;
}
