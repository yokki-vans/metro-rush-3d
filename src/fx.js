// Particle bursts (coin sparks, crash debris, dust, confetti) as one Points
// draw call, plus a trauma-based camera shake.
import * as THREE from 'three';

const MAX = 360;

export class FX {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.alp = new Float32Array(MAX);
    this.siz = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.ttl = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.head = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        varying vec3 vC; varying float vA;
        void main(){
          vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * (190.0 / max(1.0,-mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float m = smoothstep(0.5, 0.12, d);
          gl_FragColor = vec4(vC, vA * m);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // camera shake
    this.trauma = 0;
  }

  spawn(x, y, z, vx, vy, vz, color, size, ttl, grav = 9) {
    const i = this.head; this.head = (this.head + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.siz[i] = size;
    this.life[i] = ttl; this.ttl[i] = ttl;
    this.grav[i] = grav;
    this.alp[i] = 1;
  }

  burst(p, hex, n = 12, spd = 4, size = 0.5, ttl = 0.6, grav = 9, spread = 1) {
    const c = new THREE.Color(hex);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.25) * Math.PI * spread;
      const s = spd * (0.4 + Math.random() * 0.8);
      this.spawn(p.x, p.y, p.z,
        Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + spd * 0.4, Math.sin(a) * Math.cos(e) * s * 0.6,
        c, size * (0.6 + Math.random() * 0.8), ttl * (0.7 + Math.random() * 0.6), grav);
    }
  }

  dust(p, n = 5) {
    const c = new THREE.Color(0x8d8473);
    for (let k = 0; k < n; k++) {
      this.spawn(p.x + (Math.random() - .5) * .5, p.y + 0.06, p.z + (Math.random() - .5) * .4,
        (Math.random() - .5) * 1.6, 0.6 + Math.random() * 1.2, 1.5 + Math.random() * 2,
        c, 0.7 + Math.random() * 0.6, 0.5 + Math.random() * 0.3, -1.5);
    }
  }

  confetti(p) {
    const cols = [0xff5630, 0x36b37e, 0xffab00, 0x6554c0, 0x00b8d9];
    for (let k = 0; k < 26; k++) {
      const c = new THREE.Color(cols[k % cols.length]);
      this.spawn(p.x + (Math.random() - .5) * 2, p.y + 1.5, p.z - 2,
        (Math.random() - .5) * 5, 3 + Math.random() * 4, -2 - Math.random() * 4,
        c, 0.5 + Math.random() * 0.4, 1 + Math.random() * 0.5, 7);
    }
  }

  update(dt, worldDelta) {
    const { pos, vel, life, ttl, alp, grav } = this;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { alp[i] = 0; continue; }
      const j = i * 3;
      vel[j + 1] -= grav[i] * dt;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt + worldDelta;  // drift back with the world
      const f = life[i] / ttl[i];
      alp[i] = f * f;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  applyShake(camera, t) {
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    camera.position.x += Math.sin(t * 91) * 0.22 * s;
    camera.position.y += Math.cos(t * 113) * 0.18 * s;
    camera.rotation.z += Math.sin(t * 77) * 0.02 * s;
  }
}
