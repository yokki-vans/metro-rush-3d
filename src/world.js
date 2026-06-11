// World: prebuilt chunk variants per biome (recycled — zero runtime geometry
// work), instanced pools for trains/obstacles/coins, course layout generator,
// ground-height sampling (run on train roofs via ramps) and collisions.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/utils/BufferGeometryUtils.js';
import { REG, regionUV, boxUV } from './atlas.js';
import { curved } from './curveworld.js';

export const LANE_W = 2.2;
export const CHUNK_LEN = 40;
export const TRAIN_TOP = 2.6;
const AHEAD = 360, BEHIND = 50;
const CAR_LEN = 17;

const mulberry = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- geo helpers
const _tmpM = new THREE.Matrix4();
class Builder {
  constructor() { this.atlas = []; this.win = []; this.glow = []; }
  box(list, w, h, d, x, y, z, color, region = REG.plain, ry = 0, rx = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (region !== 'win') regionUV(g, region);
    this._fin(list, g, x, y, z, color, ry, rx);
    return g;
  }
  // building box with per-face window tiling (u: columns, v: floors)
  building(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    const cols = Math.max(1, Math.round(w / 2.4)), floors = Math.max(1, Math.round(h / 2.6));
    const dcols = Math.max(1, Math.round(d / 2.4));
    const uv = g.attributes.uv;
    const mul = [[dcols, floors], [dcols, floors], [1, 1], [1, 1], [cols, floors], [cols, floors]];
    for (let f = 0; f < 6; f++) {
      for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * mul[f][0], uv.getY(i) * mul[f][1]);
    }
    this._fin(this.win, g, x, y, z, color);
  }
  cyl(list, r0, r1, h, seg, x, y, z, color, rx = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg);
    regionUV(g, REG.plain);
    this._fin(list, g, x, y, z, color, 0, rx, rz);
  }
  cone(list, r, h, seg, x, y, z, color) {
    const g = new THREE.ConeGeometry(r, h, seg);
    regionUV(g, REG.plain);
    this._fin(list, g, x, y, z, color);
  }
  _fin(list, g, x, y, z, color, ry = 0, rx = 0, rz = 0) {
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    tint(g, color);
    list.push(g);
  }
}

function tint(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function instPool(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) m.setMatrixAt(i, zero);
  m.count = count;
  const free = [];
  for (let i = count - 1; i >= 0; i--) free.push(i);
  return { mesh: m, free, zero };
}

// ============================================================== world builder
export class World {
  constructor(scene, tex) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);

    // shared materials
    this.matAtlas = curved(new THREE.MeshLambertMaterial({ map: tex.atlas, vertexColors: true }));
    this.matWin = curved(new THREE.MeshLambertMaterial({
      map: tex.windows, vertexColors: true,
      emissive: 0xffffff, emissiveMap: tex.windowsE, emissiveIntensity: 0,
    }));
    this.matGlow = curved(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.matCoin = curved(new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x885f00 }));

    // pools
    this.trains = instPool(makeTrainGeo(), this.matAtlas, 24);
    this.barriers = instPool(makeBarrierGeo(), this.matAtlas, 24);
    this.gantries = instPool(makeGantryGeo(), this.matAtlas, 14);
    this.ramps = instPool(makeRampGeo(), this.matAtlas, 8);
    const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14);
    coinGeo.rotateX(Math.PI / 2);
    tint(coinGeo, 0xffffff);
    this.coinSpin = { value: 0 };
    const mc = this.matCoin;
    const prevCb = mc.onBeforeCompile;
    mc.onBeforeCompile = (sh, r) => {
      prevCb && prevCb(sh, r);
      sh.uniforms.uSpin = this.coinSpin;
      sh.vertexShader = 'uniform float uSpin;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         { float cs=cos(uSpin), sn=sin(uSpin); transformed.xz = mat2(cs,-sn,sn,cs)*transformed.xz; }`
      );
    };
    mc.customProgramCacheKey = () => 'coinspin';
    this.coins = instPool(coinGeo, this.matCoin, 130);
    for (const p of [this.trains, this.barriers, this.gantries, this.ramps, this.coins]) this.root.add(p.mesh);

    // train liveries via instance colors
    this.trainColors = [0xd64545, 0x3f7fd0, 0x3da25c, 0xe08c2d, 0xc9b438, 0x7b5cd6].map(h => new THREE.Color(h));
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < this.trains.mesh.count; i++) this.trains.mesh.setColorAt(i, white);
    this.trains.mesh.instanceColor.needsUpdate = true;

    // headlight glows for moving trains
    this.headlights = [];
    for (let i = 0; i < 3; i++) {
      const sm = new THREE.SpriteMaterial({ map: tex.glow, color: 0xffeebb, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(sm); s.scale.setScalar(2.4); s.visible = false;
      this.root.add(s); this.headlights.push(s);
    }

    // skyline silhouettes
    {
      const g = new THREE.BoxGeometry(10, 1, 12);
      g.translate(0, 0.5, 0);
      tint(g, 0x55607a);
      this.skyline = new THREE.InstancedMesh(g, curved(new THREE.MeshLambertMaterial({ vertexColors: true })), 56);
      this.skyline.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.skyline.frustumCulled = false;
      this.root.add(this.skyline);
    }

    // chunk variant library
    this.variants = {};
    const biomes = ['downtown', 'oldtown', 'park', 'industrial', 'tunnel'];
    for (const b of biomes) {
      this.variants[b] = [];
      for (let v = 0; v < 3; v++) this.variants[b].push(buildVariant(b, v, this));
    }
    // biome sequence per chunk index
    const seq = [];
    const order = ['downtown', 'oldtown', 'tunnel', 'park', 'industrial', 'downtown', 'park', 'tunnel', 'oldtown', 'industrial'];
    for (const b of order) { const n = b === 'tunnel' ? 3 : 7; for (let i = 0; i < n; i++) seq.push(b); }
    this.biomeSeq = seq;

    this.activeChunks = [];
    this.obstacles = [];
    this.coinList = [];
    this.onHorn = null;
    this.reset();
  }

  biomeAt(ci) { return this.biomeSeq[ci % this.biomeSeq.length]; }

  reset() {
    for (const c of this.activeChunks) { this.root.remove(c.group); c.variant.pool.push(c.group); }
    this.activeChunks = [];
    for (const o of this.obstacles) this._release(o);
    for (const c of this.coinList) if (!c.taken) this.coins.free.push(c.inst);
    this.obstacles = [];
    this.coinList = [];
    this.nextChunk = 0;
    this.spawnS = 70;            // obstacle-free runway
    this.laneBusy = [0, 0, 0];   // course-s until which a lane is filled by a train
    this.movingCount = [0, 0, 0]; // живые движущиеся поезда на полосе
    this._hideAll();
  }

  _hideAll() {
    for (const p of [this.trains, this.barriers, this.gantries, this.ramps, this.coins]) {
      for (let i = 0; i < p.mesh.count; i++) p.mesh.setMatrixAt(i, p.zero);
      p.mesh.instanceMatrix.needsUpdate = true;
      p.free.length = 0;
      for (let i = p.mesh.count - 1; i >= 0; i--) p.free.push(i);
    }
    for (const h of this.headlights) h.visible = false;
  }

  _release(o) {
    const pool = { train: this.trains, mtrain: this.trains, barrier: this.barriers, gantry: this.gantries }[o.kind];
    if (o.inst != null) { pool.mesh.setMatrixAt(o.inst, pool.zero); pool.free.push(o.inst); }
    if (o.inst2 != null) { pool.mesh.setMatrixAt(o.inst2, pool.zero); pool.free.push(o.inst2); }
    if (o.rampInst != null) { this.ramps.mesh.setMatrixAt(o.rampInst, this.ramps.zero); this.ramps.free.push(o.rampInst); }
    if (o.light) { o.light.visible = false; o.light = null; }
    if (o.kind === 'mtrain') this.movingCount[o.lane] = Math.max(0, this.movingCount[o.lane] - 1);
  }

  // полоса полностью свободна впереди (для спавна движущегося поезда)
  _laneClearAhead(l, dist) {
    if (this.movingCount[l] > 0) return false;
    for (const o of this.obstacles) if (o.lane === l && o.s1 > dist) return false;
    return true;
  }

  // ----------------------------------------------------------------- layout
  _spawnLayout(dist, speed) {
    while (this.spawnS < dist + AHEAD - 20) {
      const diff = Math.min(1, dist / 2600);
      const s = this.spawnS;
      const gap = Math.max(17, 26 - diff * 8 + Math.random() * 14);
      const lineMax = Math.max(3, Math.floor((gap - 6) / 2)); // монеты не дотягиваются до следующего ряда
      const r = Math.random();
      // полосы без стоящих поездов в этой точке и без живых движущихся составов
      const free = [0, 1, 2].filter(l => this.laneBusy[l] < s - 3 && this.movingCount[l] === 0);
      if (!free.length) { this.spawnS += 12; continue; }
      const lane = () => free.splice((Math.random() * free.length) | 0, 1)[0];
      // never let parked trains cover all three lanes at once
      const canTrain = () => [0, 1, 2].filter(l => this.laneBusy[l] > s).length < 2;

      if (r < 0.20) {                                   // barriers on 1-2 lanes
        const n = Math.min(Math.random() < 0.35 + diff * 0.3 ? 2 : 1, free.length);
        for (let i = 0; i < n; i++) this._addBarrier(lane(), s);
        this._maybeCoinArc(free[0], s);
      } else if (r < 0.36) {                            // roll gantries
        const n = Math.min(Math.random() < 0.3 + diff * 0.3 ? 2 : 1, free.length);
        for (let i = 0; i < n; i++) this._addGantry(lane(), s);
      } else if (r < 0.62) {                            // parked train(s)
        const n = Math.random() < 0.25 + diff * 0.45 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          if (!canTrain() || !free.length) break;
          const ln = lane();
          const cars = Math.random() < 0.4 ? 2 : 1;
          this._addTrain(ln, s + Math.random() * 8, cars, Math.random() < 0.42);
        }
        if (free.length) this._maybeCoinLine(free[0], s - 6, Math.min(8, lineMax));
      } else if (r < 0.62 + 0.16 * (0.3 + diff)) {      // moving train
        const cand = free.filter(l => this._laneClearAhead(l, dist));
        if (cand.length) {
          const ln = cand[(Math.random() * cand.length) | 0];
          free.splice(free.indexOf(ln), 1);
          this._addMovingTrain(ln, dist, speed);
          if (free.length) this._maybeCoinLine(free[0], s, Math.min(7, lineMax));
        } else {
          this._maybeCoinLine(lane(), s, Math.min(8, lineMax), true);
        }
      } else if (r < 0.86) {                            // mixed row
        if (canTrain() && free.length) this._addTrain(lane(), s, 1, Math.random() < 0.3);
        if (Math.random() < 0.7 && free.length) this._addBarrier(lane(), s + 4);
      } else {                                          // breather + coins
        this._maybeCoinLine(lane(), s, Math.min(10, lineMax), true);
      }
      this.spawnS += gap;
    }
  }

  _take(pool) { return pool.free.length ? pool.free.pop() : null; }

  _addBarrier(laneI, s) {
    const inst = this._take(this.barriers); if (inst == null) return;
    this.obstacles.push({ kind: 'barrier', lane: laneI, s0: s - 0.25, s1: s + 0.25, top: 0.92, inst });
  }

  _addGantry(laneI, s) {
    const inst = this._take(this.gantries); if (inst == null) return;
    this.obstacles.push({ kind: 'gantry', lane: laneI, s0: s - 0.2, s1: s + 0.2, gapY: 1.12, inst });
  }

  _paint(inst, color) {
    if (inst == null) return;
    this.trains.mesh.setColorAt(inst, color);
    this.trains.mesh.instanceColor.needsUpdate = true;
  }

  _addTrain(laneI, s, cars, ramp) {
    const inst = this._take(this.trains); if (inst == null) return;
    const o = { kind: 'train', lane: laneI, s0: s, s1: s + cars * CAR_LEN, top: TRAIN_TOP, inst, inst2: null, rampInst: null };
    if (cars === 2) {
      o.inst2 = this._take(this.trains);
      if (o.inst2 == null) o.s1 = s + CAR_LEN;   // пул исчерпан: не оставлять невидимый вагон-убийцу
    }
    const col = this.trainColors[(Math.random() * this.trainColors.length) | 0];
    this._paint(inst, col); this._paint(o.inst2, col);
    this.laneBusy[laneI] = Math.max(this.laneBusy[laneI], o.s1 + 6);
    if (ramp) {
      o.rampInst = this._take(this.ramps);
      if (o.rampInst != null) {
        o.rampS0 = s - 6.2; o.rampS1 = s;
        // coins on the roof
        for (let k = 0; k < 6; k++) this._addCoin(laneI, s + 2 + k * 2.2, TRAIN_TOP + 0.55);
      }
    }
    this.obstacles.push(o);
  }

  _addMovingTrain(laneI, dist, speed) {
    const inst = this._take(this.trains); if (inst == null) return;
    const inst2 = this._take(this.trains);
    const sameDir = Math.random() < 0.4;
    const v = sameDir ? -(speed * 0.45) : (9 + speed * 0.55);   // ds/dt (course units), + approaches
    const o = {
      kind: 'mtrain', lane: laneI, s0: dist + AHEAD + 60, top: TRAIN_TOP,
      len: (inst2 != null ? 2 : 1) * CAR_LEN, v, inst, inst2, honked: false,
      light: this.headlights.find(h => !h.visible) || null,
    };
    o.s1 = o.s0 + o.len;
    if (o.light) {
      o.light.visible = true;
      // у попутного состава ближний к игроку торец — хвост: красный габарит вместо фары
      o.light.material.color.setHex(sameDir ? 0xff6655 : 0xffeebb);
      o.light.scale.setScalar(sameDir ? 1.5 : 2.4);
    }
    const col = this.trainColors[(Math.random() * this.trainColors.length) | 0];
    this._paint(inst, col); this._paint(inst2, col);
    this.movingCount[laneI]++;
    // подмести монеты с пути состава, чтобы он не проезжал сквозь них
    for (const c of this.coinList) {
      if (!c.taken && c.lane === laneI && c.s > dist) {
        c.taken = true;
        this.coins.mesh.setMatrixAt(c.inst, this.coins.zero);
        this.coins.free.push(c.inst);
      }
    }
    this.obstacles.push(o);
  }

  _addCoin(laneI, s, y = 0.95) {
    const inst = this._take(this.coins); if (inst == null) return;
    this.coinList.push({ lane: laneI, s, y, inst, taken: false });
  }

  _maybeCoinLine(laneI, s, n, always = false) {
    if (laneI == null) return;
    if (!always && Math.random() < 0.35) return;
    for (let i = 0; i < n; i++) this._addCoin(laneI, s + i * 2.0);
  }

  _maybeCoinArc(laneI, s) {
    if (laneI == null && Math.random() < 0.5) return;
    const ln = laneI ?? (Math.random() * 3) | 0;
    if (this.laneBusy[ln] > s - 3 || this.movingCount[ln] > 0) return; // не сыпать монеты внутрь поезда
    for (let i = 0; i < 7; i++) {
      const f = i / 6, y = 0.95 + Math.sin(f * Math.PI) * 1.25;
      this._addCoin(ln, s - 4.5 + f * 9, y);
    }
  }

  // ----------------------------------------------------------------- update
  update(dt, dist, speed, env) {
    // chunks
    while ((this.nextChunk * CHUNK_LEN) < dist + AHEAD) this._placeChunk(this.nextChunk++);
    for (let i = this.activeChunks.length - 1; i >= 0; i--) {
      const c = this.activeChunks[i];
      if (c.start + CHUNK_LEN < dist - BEHIND) {
        this.root.remove(c.group); c.variant.pool.push(c.group);
        this.activeChunks.splice(i, 1);
      } else {
        c.group.position.z = dist - c.start;
      }
    }

    this._spawnLayout(dist, speed);

    // night-driven looks
    this.matWin.emissiveIntensity = env.night * 1.25 + env.flash * 0.2;

    // obstacles
    const M = _tmpM;
    let nearestT = 999, nearestPan = 0;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      if (o.kind === 'mtrain') {
        o.s0 -= o.v * dt; o.s1 = o.s0 + o.len;
        const dz = o.s0 - dist;
        if (o.v > 0 && !o.honked && dz < 150 && dz > 0) { o.honked = true; this.onHorn && this.onHorn(); }
        const dd = (o.s0 <= dist && o.s1 >= dist)
          ? 0
          : Math.min(Math.abs(o.s0 - dist), Math.abs(o.s1 - dist));
        if (dd < nearestT) { nearestT = dd; nearestPan = (o.lane - 1) * 0.8; }
      }
      const gone = o.kind === 'mtrain'
        ? o.s1 < dist - 45
        : o.s1 < dist - BEHIND * 0.7;
      if (gone) { this._release(o); this.obstacles.splice(i, 1); continue; }

      // write matrices
      const x = (o.lane - 1) * LANE_W;
      if (o.kind === 'barrier') {
        M.makeTranslation(x, 0, dist - (o.s0 + o.s1) / 2);
        this.barriers.mesh.setMatrixAt(o.inst, M);
      } else if (o.kind === 'gantry') {
        M.makeTranslation(x, 0, dist - (o.s0 + o.s1) / 2);
        this.gantries.mesh.setMatrixAt(o.inst, M);
      } else {
        // trains: car geometry is CAR_LEN long, origin at its near end, extends -z
        M.makeTranslation(x, 0, dist - o.s0);
        this.trains.mesh.setMatrixAt(o.inst, M);
        if (o.inst2 != null) {
          M.makeTranslation(x, 0, dist - o.s0 - CAR_LEN);
          this.trains.mesh.setMatrixAt(o.inst2, M);
        }
        if (o.rampInst != null) {
          M.makeTranslation(x, 0, dist - o.rampS0);
          this.ramps.mesh.setMatrixAt(o.rampInst, M);
        }
        if (o.light) o.light.position.set(x, 1.7, dist - o.s0 + 0.6);
      }
    }
    this.trains.mesh.instanceMatrix.needsUpdate = true;
    this.barriers.mesh.instanceMatrix.needsUpdate = true;
    this.gantries.mesh.instanceMatrix.needsUpdate = true;
    this.ramps.mesh.instanceMatrix.needsUpdate = true;

    // coins
    this.coinSpin.value += dt * 5;
    for (let i = this.coinList.length - 1; i >= 0; i--) {
      const c = this.coinList[i];
      if (c.s < dist - 12) {
        if (!c.taken) { this.coins.mesh.setMatrixAt(c.inst, this.coins.zero); this.coins.free.push(c.inst); }
        this.coinList.splice(i, 1); continue;
      }
      if (c.taken) continue;
      M.makeTranslation((c.lane - 1) * LANE_W, c.y, dist - c.s);
      this.coins.mesh.setMatrixAt(c.inst, M);
    }
    this.coins.mesh.instanceMatrix.needsUpdate = true;

    // skyline
    this._skyline(dist);

    return { trainDist: nearestT, trainPan: nearestPan };
  }

  _skyline(dist) {
    const M = _tmpM, STEP = 16;
    let idx = 0;
    const base = Math.floor(dist / STEP);
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 28; i++) {
        const slot = base + i - 4;
        const rnd = mulberry(slot * 7349 + side * 131)();
        const rnd2 = mulberry(slot * 1571 + side * 37)();
        const h = 12 + rnd * 34;
        const x = side * (36 + rnd2 * 22);
        M.makeScale(1 + rnd2 * 1.6, h, 1);
        M.setPosition(x, 0, dist - slot * STEP);
        this.skyline.setMatrixAt(idx++, M);
      }
    }
    this.skyline.instanceMatrix.needsUpdate = true;
  }

  _placeChunk(ci) {
    const biome = this.biomeAt(ci);
    const variants = this.variants[biome];
    const v = variants[ci % variants.length];
    let group = v.pool.pop();
    if (!group) {
      group = new THREE.Group();
      const mA = new THREE.Mesh(v.geoAtlas, this.matAtlas);
      const mW = v.geoWin ? new THREE.Mesh(v.geoWin, this.matWin) : null;
      const mG = v.geoGlow ? new THREE.Mesh(v.geoGlow, this.matGlow) : null;
      for (const m of [mA, mW, mG]) if (m) { m.frustumCulled = false; group.add(m); }
    }
    group.position.z = 0;
    this.root.add(group);
    this.activeChunks.push({ start: ci * CHUNK_LEN, group, variant: v, biome });
  }

  inTunnel(dist) {
    const c = this.activeChunks.find(c => dist >= c.start && dist < c.start + CHUNK_LEN);
    return c && c.biome === 'tunnel' ? 1 : 0;
  }

  // --------------------------------------------------------------- gameplay
  groundHeight(px, dist) {
    let h = 0;
    for (const o of this.obstacles) {
      if (o.kind === 'train') {
        const x = (o.lane - 1) * LANE_W;
        if (Math.abs(px - x) > 1.3) continue;
        if (dist >= o.s0 - 0.3 && dist <= o.s1 - 0.2) h = Math.max(h, o.top);
        else if (o.rampInst != null && dist >= o.rampS0 && dist < o.s0) {
          h = Math.max(h, o.top * (dist - o.rampS0) / (o.s0 - o.rampS0));
        }
      }
    }
    return h;
  }

  // player: {x, y, h (collider height), rolling}; returns 'crash' | null
  collide(dist, px, py, rolling) {
    const colH = rolling ? 0.7 : 1.5;
    for (const o of this.obstacles) {
      if (o.s1 < dist - 1.5 || o.s0 > dist + 1.5) continue;
      const x = (o.lane - 1) * LANE_W;
      const halfW = o.kind === 'barrier' ? 0.95 : o.kind === 'gantry' ? 0.85 : 1.05;
      if (Math.abs(px - x) > halfW + 0.38) continue;
      const inS = dist > o.s0 - 0.45 && dist < o.s1 + 0.45;
      if (!inS) continue;
      if (o.kind === 'barrier') {
        if (py < o.top - 0.12) return 'crash';
      } else if (o.kind === 'gantry') {
        if (py + colH > o.gapY + 0.06) return 'crash';
      } else {
        if (py < o.top - 0.55) return 'crash';
      }
    }
    return null;
  }

  collect(dist, px, py, magnetR = 0) {
    let got = 0;
    for (const c of this.coinList) {
      if (c.taken) continue;
      const dz = Math.abs(c.s - dist);
      if (dz > 1.3 + magnetR) continue;
      const cx = (c.lane - 1) * LANE_W;
      const dx = Math.abs(cx - px), dy = Math.abs(c.y - (py + 0.95));
      if ((dx < 1.0 && dy < 1.15) || (magnetR > 0 && dx < magnetR && dy < magnetR && dz < magnetR)) {
        c.taken = true;
        this.coins.mesh.setMatrixAt(c.inst, this.coins.zero);
        this.coins.free.push(c.inst);
        got++;
        c._pos = { x: cx, y: c.y };
      }
    }
    return got;
  }
}

// ===================================================================== geos
function makeTrainGeo() {
  const parts = [];
  const body = new THREE.BoxGeometry(2.0, 2.3, CAR_LEN - 0.6);
  boxUV(body, { px: REG.trainSide, nx: REG.trainSide, pz: REG.trainFront, nz: REG.trainFront, py: REG.plain, ny: REG.plain });
  body.translate(0, 0.3 + 1.15, -CAR_LEN / 2);
  tint(body, 0xffffff);
  parts.push(body);
  const roof = new THREE.BoxGeometry(1.7, 0.16, CAR_LEN - 1.0);
  regionUV(roof, REG.plain); roof.translate(0, 2.68, -CAR_LEN / 2); tint(roof, 0xb9bdc6);
  parts.push(roof);
  for (const zoff of [-3, -CAR_LEN + 3]) {
    const bog = new THREE.BoxGeometry(1.7, 0.42, 2.6);
    regionUV(bog, REG.plain); bog.translate(0, 0.21, zoff); tint(bog, 0x23252b);
    parts.push(bog);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

function makeBarrierGeo() {
  const parts = [];
  const bar = new THREE.BoxGeometry(1.9, 0.42, 0.22);
  regionUV(bar, REG.hazard); bar.translate(0, 0.7, 0); tint(bar, 0xffffff);
  parts.push(bar);
  const bar2 = new THREE.BoxGeometry(1.9, 0.16, 0.18);
  regionUV(bar2, REG.hazard); bar2.translate(0, 0.32, 0); tint(bar2, 0xd9d9de);
  parts.push(bar2);
  for (const sx of [-0.85, 0.85]) {
    const leg = new THREE.BoxGeometry(0.12, 0.92, 0.16);
    regionUV(leg, REG.plain); leg.translate(sx, 0.46, 0); tint(leg, 0x6c7077);
    parts.push(leg);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

function makeGantryGeo() {
  const parts = [];
  for (const sx of [-1.02, 1.02]) {
    const post = new THREE.BoxGeometry(0.14, 2.5, 0.14);
    regionUV(post, REG.plain); post.translate(sx, 1.25, 0); tint(post, 0x8a8f99);
    parts.push(post);
  }
  const beam = new THREE.BoxGeometry(2.2, 0.14, 0.14);
  regionUV(beam, REG.plain); beam.translate(0, 2.42, 0); tint(beam, 0x8a8f99);
  parts.push(beam);
  const sign = new THREE.BoxGeometry(2.0, 1.0, 0.1);
  boxUV(sign, { pz: REG.sign, nz: REG.sign, rest: REG.plain });
  sign.translate(0, 1.78, 0); tint(sign, 0xffffff);
  parts.push(sign);
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return g;
}

function makeRampGeo() {
  // tilted slab: origin at low end (s0), rises to TRAIN_TOP over 6.2 toward -z
  const L = Math.hypot(6.2, TRAIN_TOP);
  const slab = new THREE.BoxGeometry(1.9, 0.18, L);
  regionUV(slab, REG.hazard);
  tint(slab, 0xd8d8dc);
  slab.translate(0, 0.09, L / 2);
  slab.rotateX(-Math.atan2(TRAIN_TOP, 6.2));
  slab.rotateY(Math.PI);
  const g = slab;
  return g;
}

// =============================================================== chunk build
function buildVariant(biome, vi, world) {
  const rnd = mulberry(biome.length * 1000 + vi * 7919 + 13);
  const B = new Builder();
  const L = CHUNK_LEN;
  const Z = (s) => -s; // local: course offset s∈[0,L] → z

  // --- common ground & tracks
  const isTunnel = biome === 'tunnel';
  B.box(B.atlas, 26, 0.5, L, 0, -0.27, -L / 2, 0x3b3e44);                       // base
  B.box(B.atlas, 8.8, 0.34, L, 0, -0.15, -L / 2, 0x55504a, REG.concrete);      // ballast
  for (const tx of [-LANE_W, 0, LANE_W]) {
    for (const rx of [-0.72, 0.72]) {
      B.box(B.atlas, 0.09, 0.14, L, tx + rx, 0.1, -L / 2, 0xc7ccd6);
    }
    const n = Math.floor(L / 0.85);
    for (let i = 0; i < n; i++) {
      B.box(B.atlas, 1.9, 0.07, 0.24, tx, 0.005, Z(i * 0.85 + 0.4), 0x4d4136);
    }
  }
  // platforms
  for (const side of [-1, 1]) {
    B.box(B.atlas, 4.6, 0.62, L, side * 6.7, 0.31, -L / 2, isTunnel ? 0x6a6e76 : 0x9aa0a8, REG.concrete);
    B.box(B.atlas, 0.3, 0.08, L, side * 4.55, 0.66, -L / 2, 0xe8c93e);          // warning strip
  }

  if (isTunnel) {
    // walls + ceiling + lamps
    for (const side of [-1, 1]) {
      B.box(B.atlas, 0.8, 7.4, L, side * 9.3, 3.4, -L / 2, 0x5b5e66, REG.concrete);
      for (let s = 4; s < L; s += 8) {
        B.box(B.atlas, 1.1, 7.6, 0.5, side * 9.1, 3.5, Z(s), 0x4c4f57);
        B.box(B.glow, 0.1, 0.5, 2.4, side * 8.85, 4.4, Z(s + 4), 0xffe9b0);     // wall lamps
      }
      B.box(B.atlas, 1.4, 2.2, 2.0, side * 8.5, 1.4, Z(L * (0.3 + side * 0.2) + 8), 0x8b8f98, REG.concrete); // service niche
    }
    B.box(B.atlas, 19.4, 0.7, L, 0, 7.0, -L / 2, 0x46494f, REG.concrete);
    for (let s = 2; s < L; s += 8) {
      B.box(B.atlas, 19.4, 0.5, 0.7, 0, 6.7, Z(s), 0x3c3f45);
      B.box(B.glow, 1.6, 0.08, 0.5, 0, 6.55, Z(s + 4), 0xfff3c8);               // ceiling lights
    }
  } else {
    // catenary poles & wires
    for (let s = 6; s < L; s += 13.3) {
      for (const side of [-1, 1]) B.box(B.atlas, 0.18, 5.8, 0.18, side * 4.1, 2.9, Z(s), 0x4d525c);
      B.box(B.atlas, 8.4, 0.14, 0.14, 0, 5.7, Z(s), 0x4d525c);
    }
    for (const tx of [-LANE_W, 0, LANE_W]) B.box(B.atlas, 0.035, 0.06, L, tx, 5.15, -L / 2, 0x2c2e33);
    // street lamps (heads glow at night thanks to Basic material)
    for (let s = 9; s < L; s += 12.5) {
      const side = (Math.floor(s / 12.5) % 2) ? 1 : -1;
      B.box(B.atlas, 0.14, 4.6, 0.14, side * 8.6, 2.3, Z(s), 0x3f444d);
      B.box(B.atlas, 1.1, 0.1, 0.1, side * 8.1, 4.55, Z(s), 0x3f444d);
      B.box(B.glow, 0.5, 0.14, 0.3, side * 7.7, 4.48, Z(s), 0xfff0c0);
    }
    // fences along platform edges
    for (let s = 0; s < L; s += 4) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.85) B.box(B.atlas, 0.07, 1.0, 3.6, side * 4.75, 1.1, Z(s + 2), 0x7c828c);
      }
    }
  }

  // --- biome dressing
  const adRegs = [REG.ad0, REG.ad1, REG.ad2, REG.ad3];
  const addAd = (side, s, y = 3.4) => {
    B.box(B.atlas, 0.2, 3.0, 0.25, side * 9.6, y - 1.6, Z(s), 0x52565e);
    const p = new THREE.BoxGeometry(0.18, 1.6, 3.2);
    boxUV(p, { px: adRegs[(rnd() * 4) | 0], nx: adRegs[(rnd() * 4) | 0], rest: REG.plain });
    p.translate(side * 9.45, y, Z(s));
    tint(p, 0xffffff);
    B.atlas.push(p);
  };

  if (biome === 'downtown') {
    const palette = [0x9fb6c8, 0x8898ad, 0xa9b2c4, 0x7e93a8, 0xb6c2cf];
    for (const side of [-1, 1]) {
      let s = rnd() * 4;
      while (s < L - 6) {
        const w = 9 + rnd() * 7, d = 8 + rnd() * 6, h = 17 + rnd() * 22;
        const x = side * (12.5 + rnd() * 4 + d / 2);
        B.building(d, h, w, x, h / 2, Z(s + w / 2), palette[(rnd() * palette.length) | 0]);
        B.box(B.atlas, d + 0.4, 0.5, w + 0.4, x, h + 0.25, Z(s + w / 2), 0x5d646e);
        if (rnd() < 0.5) B.box(B.atlas, 2.2, 1.4, 2.8, x, h + 1.2, Z(s + w / 2), 0x767d88);
        s += w + 1.5 + rnd() * 5;
      }
      if (rnd() < 0.9) addAd(side, 6 + rnd() * (L - 12));
    }
  } else if (biome === 'oldtown') {
    const palette = [0xc28e63, 0xb5764f, 0xc99e72, 0xa86a48, 0xbd8a59];
    for (const side of [-1, 1]) {
      let s = rnd() * 3;
      while (s < L - 5) {
        const w = 10 + rnd() * 6, d = 7 + rnd() * 4, h = 8 + rnd() * 9;
        const x = side * (11.5 + rnd() * 3 + d / 2);
        B.building(d, h, w, x, h / 2, Z(s + w / 2), palette[(rnd() * palette.length) | 0]);
        B.box(B.atlas, d + 0.5, 0.6, w + 0.5, x, h + 0.3, 0 + Z(s + w / 2), 0x6e574a);
        if (rnd() < 0.55) {                                  // rooftop water tower
          B.cyl(B.atlas, 0.9, 0.9, 1.6, 10, x, h + 1.4, Z(s + w / 2), 0x7a5240);
          B.cone(B.atlas, 1.0, 0.7, 10, x, h + 2.55, Z(s + w / 2), 0x5d4034);
        }
        s += w + 1 + rnd() * 4;
      }
      if (rnd() < 0.7) addAd(side, 8 + rnd() * (L - 16), 3.0);
    }
  } else if (biome === 'park') {
    for (const side of [-1, 1]) {
      B.box(B.atlas, 1.6, 0.9, L, side * 5.9, 0.95, -L / 2, 0x4e7a3d);          // hedge
      let s = 2 + rnd() * 3;
      while (s < L - 3) {
        const x = side * (8.5 + rnd() * 7);
        const th = 1.6 + rnd() * 1.3;
        B.cyl(B.atlas, 0.16, 0.22, th, 7, x, th / 2 + 0.6, Z(s), 0x6b4a32);
        const greens = [0x3f7a36, 0x4c8a3f, 0x57953f, 0x35702f];
        B.cone(B.atlas, 1.5 + rnd() * 0.9, 2.6 + rnd() * 1.6, 8, x, th + 1.8, Z(s), greens[(rnd() * 4) | 0]);
        s += 3.5 + rnd() * 4;
      }
      // distant low houses
      let s2 = rnd() * 8;
      while (s2 < L - 8) {
        const w = 8 + rnd() * 6, h = 5 + rnd() * 4;
        const x = side * (19 + rnd() * 6);
        B.building(7, h, w, x, h / 2, Z(s2 + w / 2), 0xd9c9a8);
        B.cone(B.atlas, 5.4, 2.4, 4, x, h + 1.1, Z(s2 + w / 2), 0x8d5b44);
        s2 += w + 6 + rnd() * 8;
      }
    }
  } else if (biome === 'industrial') {
    const cols = [0xc25450, 0x4f7fa8, 0x58a06a, 0xc2924e, 0x8a8f99];
    for (const side of [-1, 1]) {
      let s = rnd() * 5;
      while (s < L - 8) {
        const w = 14 + rnd() * 8, h = 7 + rnd() * 5, d = 10 + rnd() * 4;
        const x = side * (13 + rnd() * 4 + d / 2);
        B.building(d, h, w, x, h / 2, Z(s + w / 2), 0xb4b9bd);
        B.box(B.atlas, d + 0.3, 1.3, w + 0.3, x, h + 0.6, Z(s + w / 2), 0x70757d);
        if (rnd() < 0.6) B.cyl(B.atlas, 0.7, 0.9, 7 + rnd() * 4, 9, x + 3, h + 3, Z(s + w / 2 + 4), 0x9b5a4a);
        s += w + 2 + rnd() * 6;
      }
      // container stacks near tracks
      let s3 = 3 + rnd() * 6;
      while (s3 < L - 7) {
        const n = 1 + (rnd() * 3 | 0);
        for (let k = 0; k < n; k++) {
          B.box(B.atlas, 2.4, 2.5, 6, side * (7.6 + rnd() * 1.2), 1.25 + k * 2.5 + 0.62, Z(s3 + 3), cols[(rnd() * cols.length) | 0]);
        }
        s3 += 8 + rnd() * 9;
      }
    }
  }

  const geoAtlas = mergeGeometries(B.atlas, false);
  const geoWin = B.win.length ? mergeGeometries(B.win, false) : null;
  const geoGlow = B.glow.length ? mergeGeometries(B.glow, false) : null;
  [...B.atlas, ...B.win, ...B.glow].forEach(g => g.dispose());
  return { geoAtlas, geoWin, geoGlow, pool: [] };
}
