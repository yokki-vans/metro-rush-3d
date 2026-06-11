// Player: the CC0 "RobotExpressive" model (from the three.js examples,
// by Tomás Laulhé / Don McCurdy) with Running / Jump / Death / Dance clips.
// Roll is a procedural somersault. Physics runs in straight course-space.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { curved } from './curveworld.js';
import { LANE_W } from './world.js';

const GRAV = 30, JUMP_V = 10.8, FALL_FAST = -17;

export class Player {
  constructor(scene, shadowTex) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    const sm = new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), curved(sm));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    scene.add(this.shadow);

    this.ready = false;
    this.reset();
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync('assets/robot.glb');
    const model = this.model = gltf.scene;
    model.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
        if (o.material) curved(o.material);
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    const s = 1.62 / h;
    model.scale.setScalar(s);
    model.rotation.y = Math.PI;            // face -z (forward)
    this.group.add(model);

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    const jump = this.actions.Jump;
    if (jump) { jump.setLoop(THREE.LoopOnce); jump.clampWhenFinished = true; }
    const death = this.actions.Death;
    if (death) { death.setLoop(THREE.LoopOnce); death.clampWhenFinished = true; }
    this.ready = true;
    this.play('Idle', 0);
  }

  play(name, fade = 0.18) {
    if (!this.ready) return;
    const next = this.actions[name];
    if (!next) return;
    if (this.current === name) {
      // once-клипы (Jump) можно перезапустить, иначе буферный прыжок замораживал позу
      if (next.loop === THREE.LoopOnce) { next.reset(); next.play(); }
      return;
    }
    next.reset();
    if (name === 'Jump') next.timeScale = 1.35;
    next.fadeIn(fade).play();
    if (this.current && this.actions[this.current]) this.actions[this.current].fadeOut(fade);
    this.current = name;
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
    this.dead = false;
    this.leanT = 0;
    this.stepT = 0;
    this.current = null;
    // остановить ВСЕ клипы: иначе clampWhenFinished-поза Death (отлетевшая
    // голова) переживала рестарт и смешивалась с бегом
    if (this.mixer) this.mixer.stopAllAction();
    if (this.model) {
      this.model.rotation.x = 0;
      this.model.rotation.z = 0;
      this.model.position.y = 0;
      this.model.position.z = 0;
    }
  }

  get worldX() { return this.x; }

  steer(dir) {                       // dir: -1 left, +1 right
    if (this.dead) return false;
    const t = this.lane + dir;
    if (t < 0 || t > 2) return false;
    this.lane = t;
    this.leanT = dir * 0.4;
    return true;
  }

  jump() {
    if (this.dead) return false;
    if (!this.grounded) {
      this.jumpBuf = 0.16;            // буфер: исполним сразу после приземления
      return false;
    }
    this.vy = JUMP_V;
    this.grounded = false;
    this.rolling = 0;
    this.rollSpin = 0;
    if (this.model) { this.model.rotation.x = 0; this.model.position.y = 0; this.model.position.z = 0; }
    this.play('Jump', 0.08);
    return true;
  }

  fastFall() {                        // swipe down in the air
    if (this.dead || this.grounded) return false;
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
    // сбросить кувырок/наклон, чтобы Death-анимация не смешивалась с вывернутой позой
    this.rolling = 0;
    this.leanT = 0;
    if (this.model) {
      this.model.rotation.x = 0;
      this.model.rotation.z = 0;
      this.model.position.y = 0;
      this.model.position.z = 0;
    }
    this.play('Death', 0.1);
  }

  idleDance() { this.play('Dance', 0.3); }
  startRun() { this.play('Running', 0.2); }

  update(dt, world, dist, speed, cb) {
    if (this.ready) this.mixer.update(dt * (this.dead ? 0.9 : 1));
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
    if (this.grounded) {
      if (this.y > gh + 0.05) {            // ran off a train roof
        this.grounded = false;
        this.vy = 0;
      } else if (gh - this.y <= 0.5) {
        this.y = gh;                       // плавный подъём (рампа)
      }
      // резкая ступень (лоб поезда) не подхватывает игрока — это смерть, решает collide
    }
    if (!this.grounded) {
      this.vy -= GRAV * dt;
      const prevY = this.y;
      this.y += this.vy * dt;
      // приземление засчитывается, только если в начале кадра игрок был НАД
      // опорой (а не влетел в лоб поезда снизу/сбоку) — размер шага не важен
      if (this.y <= gh && this.vy <= 0 && prevY >= gh - 0.05) {
        this.y = gh;
        this.grounded = true;
        cb.onLand && cb.onLand(this.y);
        if (this.jumpBuf > 0) {            // буферизованный прыжок
          this.jumpBuf = 0;
          this.rollBuf = 0;
          this.vy = JUMP_V;
          this.grounded = false;
          this.play('Jump', 0.08);
          cb.onJump && cb.onJump();
        } else {
          this.play('Running', 0.12);
          if (this.rollBuf > 0) {          // кувырок сразу после приземления
            this.rollBuf = 0;
            if (this.roll()) cb.onRoll && cb.onRoll();
          }
        }
      }
    }

    // roll: somersault around the BODY CENTRE, not the feet origin —
    // p = (I − R)·c keeps the centre fixed so nothing dips below the floor
    if (this.rolling > 0) {
      this.rolling -= dt;
      this.rollSpin += dt / 0.62 * Math.PI * 2;
      const prog = Math.min(this.rollSpin / (Math.PI * 2), 1);
      const a = -prog * Math.PI * 2;
      const c = 0.78;                       // высота центра тела
      if (this.model) {
        this.model.rotation.x = a;
        this.model.position.y = c - c * Math.cos(a);
        this.model.position.z = -c * Math.sin(a);
      }
      if (this.rolling <= 0 && this.model) {
        this.model.rotation.x = 0;
        this.model.position.y = 0;
        this.model.position.z = 0;
      }
    }

    // run cycle speed & lean
    if (this.ready && this.current === 'Running') {
      this.actions.Running.timeScale = 0.55 + speed / 16;
    }
    this.leanT *= Math.exp(-6 * dt);
    if (this.model) {
      this.model.rotation.z = -this.leanT * 1.4;
      if (this.rolling <= 0) {           // не затирать подъём корпуса во время кувырка
        this.model.position.y = this.grounded ? Math.abs(Math.sin(dist * 1.9)) * 0.03 : 0;
      }
      if (this.rolling <= 0 && this.model.rotation.x !== 0 && this.current !== 'Death') {
        this.model.rotation.x *= Math.exp(-10 * dt);
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

  colliderTop() { return this.y + (this.rolling > 0 ? 0.7 : 1.5); }
}
