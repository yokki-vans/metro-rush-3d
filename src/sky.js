// Sky dome with day/night cycle, sun & moon, stars, fog and a weather state
// machine (clear / rain / fog / snow) with smooth transitions + lightning.
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;

// keyframes over t∈[0,1): sunrise→noon→sunset→night
const KEYS = [
  { t: 0.00, top: 0x2a3a6e, hor: 0xff9a5a, sun: 0xffb36b, dir: 0.55, hemi: 0.50 },
  { t: 0.07, top: 0x3f7fd9, hor: 0xbfe3ff, sun: 0xfff3d6, dir: 1.00, hemi: 0.80 },
  { t: 0.25, top: 0x2f6fe0, hor: 0xcfeaff, sun: 0xffffff, dir: 1.15, hemi: 0.95 },
  { t: 0.42, top: 0x3a5fae, hor: 0xffc070, sun: 0xffd9a0, dir: 0.85, hemi: 0.70 },
  { t: 0.50, top: 0x232a55, hor: 0xff7040, sun: 0xff9460, dir: 0.45, hemi: 0.45 },
  { t: 0.58, top: 0x0b1030, hor: 0x2a3560, sun: 0xbdd2ff, dir: 0.22, hemi: 0.22 },
  { t: 0.75, top: 0x050818, hor: 0x101a38, sun: 0xb9cdfd, dir: 0.20, hemi: 0.16 },
  { t: 0.93, top: 0x0b1030, hor: 0x252a55, sun: 0xc9d6ff, dir: 0.22, hemi: 0.22 },
  { t: 1.00, top: 0x2a3a6e, hor: 0xff9a5a, sun: 0xffb36b, dir: 0.55, hemi: 0.50 },
];

const WEATHERS = {
  clear: { fogMul: 1.0, dim: 1.0, rain: 0, snow: 0, gray: 0.0 },
  rain:  { fogMul: 0.62, dim: 0.55, rain: 1, snow: 0, gray: 0.55 },
  fog:   { fogMul: 0.34, dim: 0.80, rain: 0, snow: 0, gray: 0.75 },
  snow:  { fogMul: 0.55, dim: 0.88, rain: 0, snow: 1, gray: 0.45 },
};

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.t = 0.10;                       // start mid-morning
    this.cycleLen = 110;                 // seconds per full day
    this.weather = 'clear';
    this.cur = { ...WEATHERS.clear };
    this.target = { ...WEATHERS.clear };
    this.wTimer = 20 + Math.random() * 18;
    this.lightning = 0;
    this.lightningT = 6;
    this.onThunder = null;

    scene.fog = new THREE.Fog(0xcfeaff, 40, 230);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x474b3f, 0.9);
    scene.add(this.hemi);
    this.dirL = new THREE.DirectionalLight(0xffffff, 1.1);
    this.dirL.position.set(-14, 26, -18);
    scene.add(this.dirL);

    // dome
    const dg = new THREE.SphereGeometry(430, 24, 12);
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x2f6fe0) },
        uHor: { value: new THREE.Color(0xcfeaff) },
        uFlash: { value: 0 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop, uHor; uniform float uFlash; varying vec3 vP;
        void main(){
          float h = clamp(normalize(vP).y, 0.0, 1.0);
          vec3 c = mix(uHor, uTop, pow(h, 0.74));
          c += vec3(0.9, 0.95, 1.0) * uFlash;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(dg, this.domeMat);
    this.dome.renderOrder = -100;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // stars
    {
      const N = 520, p = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.46 + 0.06;
        const r = 410;
        p.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      this.starMat = new THREE.PointsMaterial({
        color: 0xdfe8ff, size: 1.6, sizeAttenuation: false,
        transparent: true, opacity: 0, depthWrite: false, fog: false,
      });
      this.stars = new THREE.Points(g, this.starMat);
      this.stars.renderOrder = -95;
      this.stars.frustumCulled = false;
      scene.add(this.stars);
    }

    // sun & moon sprites
    this.sun = this._sprite(0xfff3c8, 95);
    this.moon = this._sprite(0xcfdcff, 48);

    // rain: line segments in a camera-local box
    {
      const N = this.rainN = 750;
      this.rainP = new Float32Array(N * 2 * 3);
      this.rainV = new Float32Array(N);
      for (let i = 0; i < N; i++) this._resetDrop(i, true);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.rainP, 3).setUsage(THREE.DynamicDrawUsage));
      this.rainMat = new THREE.LineBasicMaterial({
        color: 0x9fb6d9, transparent: true, opacity: 0, depthWrite: false, fog: false,
      });
      this.rain = new THREE.LineSegments(g, this.rainMat);
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 6;
      scene.add(this.rain);
    }

    // snow: points in a camera-local box
    {
      const N = this.snowN = 420;
      this.snowP = new Float32Array(N * 3);
      this.snowPh = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        this.snowP.set([(Math.random() - .5) * 44, Math.random() * 26, -Math.random() * 55 + 6], i * 3);
        this.snowPh[i] = Math.random() * 7;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.snowP, 3).setUsage(THREE.DynamicDrawUsage));
      this.snowMat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.09, transparent: true, opacity: 0, depthWrite: false,
      });
      this.snow = new THREE.Points(g, this.snowMat);
      this.snow.frustumCulled = false;
      this.snow.renderOrder = 6;
      scene.add(this.snow);
    }

    this._cTop = new THREE.Color(); this._cHor = new THREE.Color();
    this._cSun = new THREE.Color(); this._gray = new THREE.Color(0x8a93a3);
    this._fogC = new THREE.Color();
  }

  _sprite(hex, scale) {
    const mat = new THREE.SpriteMaterial({
      map: this._glowTex || (this._glowTex = makeGlowTex()),
      color: hex, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(scale);
    s.renderOrder = -90;
    this.scene.add(s);
    return s;
  }

  _resetDrop(i, randomY = false) {
    const x = (Math.random() - .5) * 46, z = -Math.random() * 60 + 8;
    const y = randomY ? Math.random() * 24 : 22 + Math.random() * 4;
    const len = 0.55 + Math.random() * 0.5;
    this.rainP.set([x, y, z, x + 0.06, y - len, z], i * 6);
    this.rainV[i] = 26 + Math.random() * 9;
  }

  setWeather(w) {
    this.weather = w;
    this.target = { ...WEATHERS[w] };
  }

  update(dt, camera, inTunnel = 0) {
    this.t = (this.t + dt / this.cycleLen) % 1;
    const t = this.t;

    // keyframe interpolation
    let k0 = KEYS[0], k1 = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { k0 = KEYS[i]; k1 = KEYS[i + 1]; break; }
    }
    const f = (t - k0.t) / Math.max(1e-5, k1.t - k0.t);
    this._cTop.setHex(k0.top).lerp(new THREE.Color(k1.top), f);
    this._cHor.setHex(k0.hor).lerp(new THREE.Color(k1.hor), f);
    this._cSun.setHex(k0.sun).lerp(new THREE.Color(k1.sun), f);
    let dirI = lerp(k0.dir, k1.dir, f);
    let hemiI = lerp(k0.hemi, k1.hemi, f);

    // weather transition
    this.wTimer -= dt;
    if (this.wTimer <= 0) {
      const roll = Math.random();
      const next = roll < 0.42 ? 'clear' : roll < 0.66 ? 'rain' : roll < 0.83 ? 'fog' : 'snow';
      this.setWeather(next === this.weather ? 'clear' : next);
      this.wTimer = 26 + Math.random() * 22;
    }
    const W = this.cur, TG = this.target, wk = Math.min(1, dt / 5);
    for (const key of Object.keys(W)) W[key] = lerp(W[key], TG[key], wk);

    // 0 днём, плавно 1 ночью (t∈0.60..0.90), с рассветным спадом
    const night = THREE.MathUtils.smoothstep(t, 0.52, 0.60) * (1 - THREE.MathUtils.smoothstep(t, 0.90, 0.98));

    // gray out for bad weather
    this._cTop.lerp(this._gray, W.gray * 0.8 * (1 - night * 0.5));
    this._cHor.lerp(this._gray, W.gray * (1 - night * 0.6));
    dirI *= W.dim; hemiI = hemiI * lerp(1, 0.75, W.gray) + 0.06;

    // lightning during rain
    this.lightning = Math.max(0, this.lightning - dt * 6);
    if (W.rain > 0.6) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightning = 0.9 + Math.random() * 0.4;
        this.lightningT = 4 + Math.random() * 9;
        if (this.onThunder) this.onThunder(0.3 + Math.random() * 1.2);
      }
    }
    const flash = Math.min(1, this.lightning);

    // apply
    this.domeMat.uniforms.uTop.value.copy(this._cTop);
    this.domeMat.uniforms.uHor.value.copy(this._cHor);
    this.domeMat.uniforms.uFlash.value = flash * 0.55;
    this.hemi.intensity = hemiI + flash * 1.4;
    this.hemi.color.copy(this._cHor).lerp(new THREE.Color(0xffffff), 0.4);
    this.hemi.groundColor.setHex(0x3c4038).lerp(this._cHor, 0.25);
    this.dirL.intensity = dirI + flash * 1.2;
    this.dirL.color.copy(this._cSun);

    // fog — denser in weather & tunnels
    const fogFar = lerp(60, 235 * W.fogMul, 1 - inTunnel * 0.55);
    this._fogC.copy(this._cHor);
    this.scene.fog.color.copy(this._fogC);
    this.scene.fog.near = lerp(34, 10, Math.max(W.gray, inTunnel));
    this.scene.fog.far = Math.max(70, fogFar);

    // celestial positions (relative to camera so they sit on the dome)
    const sunA = (t - 0.5) * Math.PI * 2;          // t=.25 → overhead
    const sx = Math.cos(sunA) * 290, sy = Math.sin(-sunA) * 230 - 30, sz = -260;
    this.sun.position.set(camera.position.x + sx, Math.max(camera.position.y + sy, -60), camera.position.z + sz);
    this.moon.position.set(camera.position.x - sx * 0.9, Math.max(camera.position.y - sy * 0.9, -60), camera.position.z + sz * 0.8);
    this.sun.material.opacity = THREE.MathUtils.clamp((sy + 80) / 160, 0, 1) * (1 - W.gray * 0.85) * (1 - night);
    this.moon.material.opacity = night * 0.9 * (1 - W.gray * 0.7);
    this.starMat.opacity = night * (1 - W.gray * 0.8) * 0.9;

    this.dome.position.copy(camera.position);
    this.stars.position.set(camera.position.x, camera.position.y - 30, camera.position.z);

    // rain update
    const rainA = W.rain * (1 - inTunnel);
    this.rainMat.opacity = rainA * 0.5;
    if (rainA > 0.02) {
      for (let i = 0; i < this.rainN; i++) {
        const j = i * 6, dy = this.rainV[i] * dt;
        this.rainP[j + 1] -= dy; this.rainP[j + 4] -= dy;
        if (this.rainP[j + 1] < -1) this._resetDrop(i);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.position.set(camera.position.x, 0, camera.position.z);
    }
    // snow update
    const snowA = this.cur.snow * (1 - inTunnel);
    this.snowMat.opacity = snowA * 0.95;
    if (snowA > 0.02) {
      for (let i = 0; i < this.snowN; i++) {
        const j = i * 3;
        this.snowPh[i] += dt;
        this.snowP[j] += Math.sin(this.snowPh[i] * 1.7) * dt * 0.7;
        this.snowP[j + 1] -= dt * (1.6 + (i % 5) * 0.3);
        if (this.snowP[j + 1] < -0.5) this.snowP[j + 1] = 24;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.position.set(camera.position.x, 0, camera.position.z);
    }

    return { night, rain: rainA, flash, weather: this.weather, dayT: t };
  }
}

function makeGlowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
