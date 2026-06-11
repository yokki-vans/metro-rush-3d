// Player: физика в «прямом» курсовом пространстве + сменные визуальные риги:
// RobotRig (CC0-модель RobotExpressive с клипами) и процедурные персонажи
// из characters.js (кот/ниндзя/капибара) с кодовой анимацией.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { curved } from './curveworld.js';
import { LANE_W } from './world.js';
import { makeProcRig, PROC_IDS } from './characters.js';

const GRAV = 30, JUMP_V = 10.8, FALL_FAST = -17;

// ----------------------------------------------------------- риг робота GLTF
class RobotRig {
  constructor(gltf) {
    this.root = new THREE.Group();
    const scene = this.scene = gltf.scene;
    scene.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
        if (o.material) curved(o.material);
      }
    });
    const box = new THREE.Box3().setFromObject(scene);
    scene.scale.setScalar(1.62 / (box.max.y - box.min.y));
    scene.rotation.y = Math.PI;            // лицом вперёд (-z)
    this.root.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    for (const n of ['Jump', 'Death']) {
      if (this.actions[n]) { this.actions[n].setLoop(THREE.LoopOnce); this.actions[n].clampWhenFinished = true; }
    }
    this.current = null;
  }

  _play(name, fade = 0.16) {
    const next = this.actions[name];
    if (!next) return;
    if (this.current === name) {
      // once-клипы (Jump) перезапускаются, иначе буферный прыжок замораживал позу
      if (next.loop === THREE.LoopOnce) { next.reset(); next.play(); }
      return;
    }
    next.reset();
    if (name === 'Jump') next.timeScale = 1.35;
    next.fadeIn(fade).play();
    if (this.current && this.actions[this.current]) this.actions[this.current].fadeOut(fade);
    this.current = name;
  }

  setState(name) {
    const map = { idle: 'Idle', dance: 'Dance', run: 'Running', jump: 'Jump', death: 'Death' };
    this._play(map[name] || 'Idle', name === 'jump' ? 0.08 : name === 'death' ? 0.1 : 0.16);
  }

  reset() {
    // остановить ВСЕ клипы: clampWhenFinished-поза Death не должна пережить рестарт
    this.mixer.stopAllAction();
    this.current = null;
  }

  applySkin(def) {
    this.scene.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      if (!m.userData.base) {
        m.userData.base = {
          color: m.color.getHex(),
          emissive: m.emissive ? m.emissive.getHex() : 0,
          ei: m.emissiveIntensity ?? 1,
          op: m.opacity, tr: m.transparent,
        };
      }
      const b = m.userData.base;
      const role = /main/i.test(m.name) ? 'primary'
        : /grey|gray|metal|silver/i.test(m.name) ? 'secondary' : 'other';
      if (!def || def.id === 'classic') {
        m.color.setHex(b.color);
        if (m.emissive) m.emissive.setHex(b.emissive);
        m.emissiveIntensity = b.ei;
        m.opacity = b.op; m.transparent = b.tr;
      } else {
        if (role === 'primary') {
          m.color.setHex(def.primary);
          m.emissive.setHex(def.glow); m.emissiveIntensity = def.glowInt;
        } else if (role === 'secondary') {
          m.color.setHex(def.secondary);
          m.emissive.setHex(def.glow); m.emissiveIntensity = def.glowInt * 0.35;
        } else if (m.emissive) {
          m.emissive.setHex(def.glow); m.emissiveIntensity = def.glowInt * 0.15;
        }
        m.opacity = def.opacity ?? 1;
        m.transparent = (def.opacity ?? 1) < 1;
      }
      m.needsUpdate = true;
    });
  }

  update(dt, ctx) {
    this.mixer.update(dt * (ctx.dead ? 0.9 : 1));
    if (this.current === 'Running' && this.actions.Running) {
      this.actions.Running.timeScale = 0.55 + ctx.speed / 16;
    }
  }
}

// ==================================================================== Player
export class Player {
  constructor(scene, shadowTex, toonGrad) {
    this.scene = scene;
    this.toonGrad = toonGrad;
    this.group = new THREE.Group();
    scene.add(this.group);

    const sm = new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), curved(sm));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    scene.add(this.shadow);

    // пузырь щита
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 18, 12),
      curved(new THREE.MeshBasicMaterial({
        color: 0x6fc4ff, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }))
    );
    this.bubble.position.y = 0.88;
    this.bubble.visible = false;
    this.bubble.renderOrder = 6;
    this.group.add(this.bubble);
    this.bubbleT = 0;

    this.rig = null;
    this.charId = null;
    this.lastState = 'idle';
    this.ready = false;
    this.procCache = {};
    this.reset();
  }

  get model() { return this.rig ? this.rig.root : null; }

  async load() {
    const gltf = await new GLTFLoader().loadAsync('assets/robot.glb');
    this.robotRig = new RobotRig(gltf);
    this.ready = true;
    this.setCharacter(this.pendingChar || 'robot');
    if (this.pendingSkin) this.robotRig.applySkin(this.pendingSkin);
    this._state('idle');
  }

  // смена персонажа: робот или процедурный (cat/ninja/capy)
  setCharacter(id) {
    if (!this.ready) { this.pendingChar = id; return; }
    if (id === this.charId && this.rig) return;
    if (this.rig) this.group.remove(this.rig.root);
    if (id === 'robot' || !PROC_IDS.includes(id)) {
      this.rig = this.robotRig;
      id = 'robot';
      if (this.pendingSkin) this.robotRig.applySkin(this.pendingSkin);
    } else {
      this.rig = this.procCache[id] || (this.procCache[id] = makeProcRig(id, this.toonGrad));
    }
    this.charId = id;
    this.rig.reset();
    this.rig.root.rotation.set(0, 0, 0);
    this.rig.root.position.set(0, 0, 0);
    this.rig.root.visible = true;
    this.group.add(this.rig.root);
    this.rig.setState(this.lastState);
  }

  applySkin(def) {
    this.pendingSkin = def;
    if (this.robotRig) this.robotRig.applySkin(def);
  }

  _state(name) {
    this.lastState = name;
    if (this.rig) this.rig.setState(name);
  }

  setShield(on) { if (this.bubble) this.bubble.visible = on; }

  saveHop() {                          // спасительный прыжок при срабатывании щита
    this.vy = Math.max(this.vy, 12.5);
    this.grounded = false;
    this.rolling = 0;
    this._state('jump');
  }

  reset() {
    this.lane = 1;
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.rolling = 0;
    this.rollSpin = 0;
    this.jumpBuf = 0;          // «нажал прыжок чуть раньше приземления»
    this.rollBuf = 0;          // свайп вниз в воздухе → кувырок при касании
    this.boostJump = false;
    this.flying = false;       // джетпак
    if (this.bubble) this.bubble.visible = false;
    this.dead = false;
    this.leanT = 0;
    this.stepT = 0;
    if (this.rig) {
      this.rig.reset();
      this.rig.root.rotation.set(0, 0, 0);
      this.rig.root.position.set(0, 0, 0);
      this.rig.root.visible = true;
    }
  }

  steer(dir) {                       // dir: -1 left, +1 right
    if (this.dead) return false;
    const t = this.lane + dir;
    if (t < 0 || t > 2) return false;
    this.lane = t;
    this.leanT = dir * 0.4;
    return true;
  }

  jump() {
    if (this.dead || this.flying) return false;
    if (!this.grounded) {
      this.jumpBuf = 0.16;            // буфер: исполним сразу после приземления
      return false;
    }
    this.vy = JUMP_V * (this.boostJump ? 1.34 : 1);   // супер-кроссовки: выше поездов
    this.grounded = false;
    this.rolling = 0;
    this.rollSpin = 0;
    const R = this.model;
    if (R) { R.rotation.x = 0; R.position.y = 0; R.position.z = 0; }
    this._state('jump');
    return true;
  }

  fastFall() {                        // swipe down in the air
    if (this.dead || this.grounded || this.flying) return false;
    this.vy = FALL_FAST;
    this.rollBuf = 0.22;              // как в раннерах: вниз в воздухе = кувырок при касании
    return true;
  }

  roll() {
    if (this.dead || !this.grounded) return false;
    this.rolling = 0.62;
    this.rollSpin = 0;
    return true;
  }

  die() {
    this.dead = true;
    // сбросить кувырок/наклон, чтобы анимация смерти не смешивалась с вывернутой позой
    this.rolling = 0;
    this.leanT = 0;
    this.flying = false;
    const R = this.model;
    if (R) {
      R.rotation.x = 0;
      R.rotation.z = 0;
      R.position.y = 0;
      R.position.z = 0;
    }
    this._state('death');
  }

  idleDance() { this._state('dance'); }
  startRun() { this._state('run'); }

  update(dt, world, dist, speed, cb) {
    if (this.rig) this.rig.update(dt, { speed, grounded: this.grounded, dead: this.dead, rolling: this.rolling > 0 });
    if (this.dead) {
      // погибший в прыжке падает на землю, а не зависает в воздухе
      if (!this.grounded) {
        this.vy -= GRAV * dt;
        const prevY = this.y;
        this.y += this.vy * dt;
        const gh = world.groundHeight(this.x, dist);
        if (this.y <= gh && prevY >= gh - 0.05) { this.y = gh; this.grounded = true; }
        else if (this.y <= 0) { this.y = 0; this.grounded = true; }   // упал мимо крыш — на полотно
      }
      this.group.position.set(this.x, this.y, 0);
      this.shadow.position.set(this.x, world.groundHeight(this.x, dist) + 0.03, 0);
      return;
    }
    this.jumpBuf -= dt;
    this.rollBuf -= dt;

    // lane x
    const targetX = (this.lane - 1) * LANE_W;
    const k = 1 - Math.exp(-13 * dt);
    this.x += (targetX - this.x) * k;

    // vertical
    const gh = world.groundHeight(this.x, dist);
    if (this.flying) {
      // джетпак: паришь над составами
      this.y += (4.25 - this.y) * Math.min(1, dt * 5);
      this.vy = 0;
      this.grounded = false;
    } else if (this.grounded) {
      if (this.y > gh + 0.05) {            // ran off a train roof
        this.grounded = false;
        this.vy = 0;
      } else if (gh - this.y <= 0.5) {
        this.y = gh;                       // плавный подъём (рампа)
      }
      // резкая ступень (лоб поезда) не подхватывает игрока — это смерть, решает collide
    }
    if (!this.grounded && !this.flying) {
      this.vy -= GRAV * dt;
      const prevY = this.y;
      this.y += this.vy * dt;
      // приземление засчитывается, только если в начале кадра игрок был НАД опорой
      if (this.y <= gh && this.vy <= 0 && prevY >= gh - 0.05) {
        this.y = gh;
        this.grounded = true;
        cb.onLand && cb.onLand(this.y);
        if (this.jumpBuf > 0) {            // буферизованный прыжок
          this.jumpBuf = 0;
          this.rollBuf = 0;
          this.vy = JUMP_V * (this.boostJump ? 1.34 : 1);
          this.grounded = false;
          this._state('jump');
          cb.onJump && cb.onJump();
        } else {
          this._state('run');
          if (this.rollBuf > 0) {          // кувырок сразу после приземления
            this.rollBuf = 0;
            if (this.roll()) cb.onRoll && cb.onRoll();
          }
        }
      }
    }

    const R = this.model;
    // roll: somersault around the BODY CENTRE — ничего не уходит под пол
    if (this.rolling > 0) {
      this.rolling -= dt;
      this.rollSpin += dt / 0.62 * Math.PI * 2;
      const prog = Math.min(this.rollSpin / (Math.PI * 2), 1);
      const a = -prog * Math.PI * 2;
      const c = 0.78;
      if (R) {
        R.rotation.x = a;
        R.position.y = c - c * Math.cos(a);
        R.position.z = -c * Math.sin(a);
      }
      if (this.rolling <= 0 && R) {
        R.rotation.x = 0;
        R.position.y = 0;
        R.position.z = 0;
      }
    }

    // пульс пузыря щита
    if (this.bubble && this.bubble.visible) {
      this.bubbleT += dt;
      this.bubble.material.opacity = 0.2 + Math.sin(this.bubbleT * 5) * 0.07;
      this.bubble.scale.setScalar(1 + Math.sin(this.bubbleT * 3.3) * 0.04);
    }

    // наклон при смене полосы
    this.leanT *= Math.exp(-6 * dt);
    if (R) {
      R.rotation.z = -this.leanT * 1.4;
      if (this.rolling <= 0) {
        R.position.y = this.grounded ? Math.abs(Math.sin(dist * 1.9)) * 0.03 : 0;
        if (this.flying) R.position.y = Math.sin(performance.now() / 280) * 0.1;  // парение
      }
      if (this.rolling <= 0 && R.rotation.x !== 0 && !this.dead) {
        R.rotation.x *= Math.exp(-10 * dt);
      }
    }

    // footstep dust
    this.stepT -= dt;
    if (this.grounded && this.rolling <= 0 && speed > 6 && this.stepT <= 0) {
      this.stepT = 2.4 / speed;
      cb.onStep && cb.onStep();
    }

    this.group.position.set(this.x, this.y, 0);

    // blob shadow
    const sh = world.groundHeight(this.x, dist);
    this.shadow.position.set(this.x, sh + 0.03, 0);
    const air = THREE.MathUtils.clamp(1 - (this.y - sh) / 3, 0.25, 1);
    this.shadow.scale.setScalar(air);
    this.shadow.material.opacity = air;
  }
}
