// Процедурные персонажи: собраны из примитивов, анимируются кодом
// (бег/прыжок/смерть/танец). Полностью оригинальные, без внешних ассетов.
import * as THREE from 'three';
import { curved } from './curveworld.js';

function toon(grad, color, emissive = 0, ei = 0) {
  return curved(new THREE.MeshToonMaterial({
    color, gradientMap: grad, emissive, emissiveIntensity: ei,
  }));
}

function box(mat, w, h, d, x = 0, y = 0, z = 0, r = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (r) m.rotation.x = r;
  m.frustumCulled = false;
  return m;
}
function ball(mat, rad, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 12, 9), mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.frustumCulled = false;
  return m;
}
function cone(mat, r, h, x = 0, y = 0, z = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), mat);
  m.position.set(x, y, z);
  m.rotation.z = rz;
  m.frustumCulled = false;
  return m;
}

// ====================================================================== КОТ
function buildCat(grad) {
  const fur = toon(grad, 0xf09a3e), dark = toon(grad, 0xc97a28);
  const cream = toon(grad, 0xffe4c0), dk = toon(grad, 0x3a2c20);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.62;
  root.add(body);
  const torso = ball(fur, 0.42, 0, 0, 0.05, 1.0, 0.82, 1.35);
  body.add(torso);
  body.add(ball(cream, 0.3, 0, -0.12, 0.32, 1, 0.7, 1));      // пузико
  const head = new THREE.Group();
  head.position.set(0, 0.32, -0.5);
  body.add(head);
  head.add(ball(fur, 0.3, 0, 0, 0, 1.1, 1, 1));
  head.add(ball(cream, 0.16, 0, -0.08, -0.22, 1.2, 0.9, 0.8)); // мордочка
  head.add(ball(dk, 0.05, 0, -0.02, -0.34));                   // нос
  head.add(ball(dk, 0.045, -0.13, 0.08, -0.26));               // глаза
  head.add(ball(dk, 0.045, 0.13, 0.08, -0.26));
  const earL = cone(dark, 0.1, 0.22, -0.18, 0.3, 0, 0.25);
  const earR = cone(dark, 0.1, 0.22, 0.18, 0.3, 0, -0.25);
  head.add(earL, earR);
  const tail = new THREE.Group();
  tail.position.set(0, 0.18, 0.55);
  body.add(tail);
  const t1 = box(dark, 0.1, 0.1, 0.42, 0, 0.1, 0.18, -0.7);
  tail.add(t1);
  const legs = [];
  for (const [lx, lz] of [[-0.22, -0.32], [0.22, -0.32], [-0.22, 0.34], [0.22, 0.34]]) {
    const leg = new THREE.Group();
    leg.position.set(lx, -0.25, lz);
    leg.add(box(fur, 0.15, 0.42, 0.16, 0, -0.18, 0));
    leg.add(box(cream, 0.16, 0.12, 0.18, 0, -0.36, -0.02));    // лапка
    body.add(leg);
    legs.push(leg);
  }
  return {
    root,
    animate(mode, ctx, time, deadT) {
      const ph = ctx.runPhase;
      if (mode === 'death') {
        const f = Math.min(1, deadT * 2.2);
        root.rotation.x = f * 1.5;                    // на спинку
        body.position.y = 0.62 - f * 0.3;
        legs.forEach((l, i) => { l.rotation.x = Math.sin(time * 6 + i) * 0.3 * (1 - f); });
        return;
      }
      root.rotation.x = 0;
      if (mode === 'dance') {
        body.position.y = 0.62 + Math.abs(Math.sin(time * 5)) * 0.16;
        body.rotation.y = Math.sin(time * 2.6) * 0.5;
        tail.rotation.y = Math.sin(time * 7) * 0.7;
        head.rotation.z = Math.sin(time * 5) * 0.18;
        legs.forEach((l, i) => { l.rotation.x = Math.sin(time * 5 + i * 1.6) * 0.5; });
        return;
      }
      body.rotation.y = 0;
      if (!ctx.grounded) {                            // прыжок: лапы поджаты
        legs[0].rotation.x = legs[1].rotation.x = -0.9;
        legs[2].rotation.x = legs[3].rotation.x = 0.9;
        body.rotation.x = -0.15;
        tail.rotation.x = 0.5;
      } else {
        body.rotation.x = 0.04;
        // диагональный галоп
        legs[0].rotation.x = Math.sin(ph) * 0.95;
        legs[3].rotation.x = Math.sin(ph) * 0.95;
        legs[1].rotation.x = Math.sin(ph + Math.PI) * 0.95;
        legs[2].rotation.x = Math.sin(ph + Math.PI) * 0.95;
        body.position.y = 0.62 + Math.abs(Math.sin(ph)) * 0.06;
      }
      tail.rotation.y = Math.sin(time * 6) * 0.45;
      head.rotation.x = Math.sin(ph * 2) * 0.05;
    },
  };
}

// =================================================================== НИНДЗЯ
function buildNinja(grad) {
  const suit = toon(grad, 0x2c3460), suitD = toon(grad, 0x1f2547);
  const skin = toon(grad, 0xf0c8a0), red = toon(grad, 0xe04848);
  const steel = toon(grad, 0xb9c2cc);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.78;
  root.add(body);
  body.add(box(suit, 0.46, 0.56, 0.3, 0, 0.1, 0));
  body.add(box(red, 0.48, 0.1, 0.32, 0, -0.14, 0));            // пояс
  const head = new THREE.Group();
  head.position.set(0, 0.56, 0);
  body.add(head);
  head.add(ball(suit, 0.22, 0, 0, 0, 1, 1.05, 1));
  head.add(box(skin, 0.3, 0.1, 0.06, 0, 0.02, -0.2));          // прорезь глаз
  head.add(ball(suitD, 0.035, -0.08, 0.02, -0.23));
  head.add(ball(suitD, 0.035, 0.08, 0.02, -0.23));
  head.add(box(red, 0.46, 0.07, 0.26, 0, 0.12, 0));            // повязка
  const scarf1 = box(red, 0.16, 0.1, 0.3, 0, 0.1, 0.26);
  const scarf2 = box(red, 0.12, 0.08, 0.26, 0, 0.08, 0.5);
  head.add(scarf1, scarf2);
  // катана за спиной
  const kat = new THREE.Group();
  kat.position.set(0.12, 0.3, 0.2);
  kat.rotation.z = 0.6;
  kat.add(box(steel, 0.05, 0.7, 0.05, 0, 0.2, 0));
  kat.add(box(suitD, 0.08, 0.22, 0.08, 0, -0.26, 0));
  body.add(kat);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.3, 0.3, 0); armR.position.set(0.3, 0.3, 0);
  armL.add(box(suit, 0.13, 0.5, 0.14, 0, -0.2, 0));
  armR.add(box(suit, 0.13, 0.5, 0.14, 0, -0.2, 0));
  armL.add(ball(skin, 0.075, 0, -0.45, 0));
  armR.add(ball(skin, 0.075, 0, -0.45, 0));
  body.add(armL, armR);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13, -0.18, 0); legR.position.set(0.13, -0.18, 0);
  legL.add(box(suitD, 0.16, 0.52, 0.18, 0, -0.24, 0));
  legR.add(box(suitD, 0.16, 0.52, 0.18, 0, -0.24, 0));
  legL.add(box(red, 0.17, 0.1, 0.24, 0, -0.5, -0.03));
  legR.add(box(red, 0.17, 0.1, 0.24, 0, -0.5, -0.03));
  body.add(legL, legR);
  return {
    root,
    animate(mode, ctx, time, deadT) {
      const ph = ctx.runPhase;
      if (mode === 'death') {
        const f = Math.min(1, deadT * 2.2);
        root.rotation.x = f * 1.45;
        body.position.y = 0.78 - f * 0.35;
        armL.rotation.x = armR.rotation.x = -f * 2.4;
        return;
      }
      root.rotation.x = 0;
      if (mode === 'dance') {
        body.position.y = 0.78 + Math.abs(Math.sin(time * 6)) * 0.12;
        body.rotation.y = Math.sin(time * 3) * 0.8;
        armL.rotation.z = 0.6 + Math.sin(time * 6) * 0.5;
        armR.rotation.z = -0.6 - Math.sin(time * 6 + 1) * 0.5;
        return;
      }
      body.rotation.y = 0;
      armL.rotation.z = 0.12; armR.rotation.z = -0.12;
      scarf1.rotation.x = 0.25 + Math.sin(time * 9) * 0.25;
      scarf2.rotation.x = 0.35 + Math.sin(time * 9 + 0.7) * 0.4;
      if (!ctx.grounded) {
        legL.rotation.x = -1.0; legR.rotation.x = 0.65;
        armL.rotation.x = 1.4; armR.rotation.x = -1.2;
        body.rotation.x = -0.1;
      } else {
        body.rotation.x = 0.14;                       // наклон вперёд — спринт
        legL.rotation.x = Math.sin(ph) * 1.05;
        legR.rotation.x = Math.sin(ph + Math.PI) * 1.05;
        armL.rotation.x = Math.sin(ph + Math.PI) * 0.95;
        armR.rotation.x = Math.sin(ph) * 0.95;
        body.position.y = 0.78 + Math.abs(Math.sin(ph)) * 0.05;
      }
    },
  };
}

// ================================================================= КАПИБАРА
function buildCapy(grad) {
  const fur = toon(grad, 0x9a6a42), furD = toon(grad, 0x7c5230);
  const muz = toon(grad, 0xc2966a), dk = toon(grad, 0x33271c);
  const orange = toon(grad, 0xff9a28), leaf = toon(grad, 0x4c9a3f);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.6;
  root.add(body);
  body.add(ball(fur, 0.5, 0, 0.02, 0.05, 1.05, 0.88, 1.4));    // массивное тело
  const head = new THREE.Group();
  head.position.set(0, 0.3, -0.62);
  body.add(head);
  head.add(box(fur, 0.46, 0.4, 0.5, 0, 0, 0));                 // прямоугольная морда
  head.add(box(muz, 0.4, 0.24, 0.2, 0, -0.1, -0.22));
  head.add(ball(dk, 0.05, -0.1, -0.04, -0.33));                // ноздри
  head.add(ball(dk, 0.05, 0.1, -0.04, -0.33));
  head.add(ball(dk, 0.05, -0.16, 0.12, -0.2));                 // глаза (невозмутимые)
  head.add(ball(dk, 0.05, 0.16, 0.12, -0.2));
  head.add(ball(furD, 0.07, -0.17, 0.22, 0.05));               // ушки
  head.add(ball(furD, 0.07, 0.17, 0.22, 0.05));
  // мандаринка на голове
  const tang = new THREE.Group();
  tang.position.set(0, 0.28, 0);
  tang.add(ball(orange, 0.11, 0, 0.05, 0));
  tang.add(box(leaf, 0.1, 0.03, 0.05, 0.03, 0.16, 0));
  head.add(tang);
  const legs = [];
  for (const [lx, lz] of [[-0.26, -0.38], [0.26, -0.38], [-0.26, 0.42], [0.26, 0.42]]) {
    const leg = new THREE.Group();
    leg.position.set(lx, -0.3, lz);
    leg.add(box(furD, 0.17, 0.36, 0.18, 0, -0.14, 0));
    body.add(leg);
    legs.push(leg);
  }
  return {
    root,
    animate(mode, ctx, time, deadT) {
      const ph = ctx.runPhase;
      if (mode === 'death') {
        const f = Math.min(1, deadT * 2);
        root.rotation.z = f * 1.5;                    // невозмутимо завалилась набок
        body.position.y = 0.6 - f * 0.22;
        return;
      }
      root.rotation.z = 0;
      if (mode === 'dance') {
        body.position.y = 0.6 + Math.abs(Math.sin(time * 4)) * 0.08;
        body.rotation.y = Math.sin(time * 2) * 0.35;
        head.rotation.z = Math.sin(time * 4) * 0.12;
        return;
      }
      body.rotation.y = 0;
      head.rotation.z = 0;
      if (!ctx.grounded) {
        legs.forEach((l, i) => { l.rotation.x = (i < 2 ? -0.7 : 0.7); });
        body.rotation.x = -0.1;
      } else {
        body.rotation.x = 0.02;
        // стоический семенящий бег — лапки молотят, тело невозмутимо
        legs[0].rotation.x = Math.sin(ph * 1.6) * 0.8;
        legs[3].rotation.x = Math.sin(ph * 1.6) * 0.8;
        legs[1].rotation.x = Math.sin(ph * 1.6 + Math.PI) * 0.8;
        legs[2].rotation.x = Math.sin(ph * 1.6 + Math.PI) * 0.8;
        body.position.y = 0.6 + Math.abs(Math.sin(ph * 1.6)) * 0.025;
      }
      tang.rotation.z = Math.sin(time * 3) * 0.06;    // мандаринка чуть покачивается
    },
  };
}

const BUILDERS = { cat: buildCat, ninja: buildNinja, capy: buildCapy };

// единый интерфейс процедурного рига (совместим с RobotRig в player.js)
export function makeProcRig(id, grad) {
  const spec = BUILDERS[id](grad);
  let mode = 'idle', time = 0, deadT = 0, runPhase = 0;
  return {
    root: spec.root,
    isProc: true,
    setState(name) {
      if (name === 'death') deadT = 0;
      mode = name === 'jump' ? 'run' : name;   // прыжок у процедурных — поза по ctx.grounded
    },
    reset() {
      mode = 'idle'; deadT = 0; runPhase = 0;
      spec.root.rotation.set(0, 0, 0);
    },
    applySkin() { /* скины — только у робота */ },
    update(dt, ctx) {
      time += dt;
      if (mode === 'death') deadT += dt;
      if (ctx.grounded && (mode === 'run')) runPhase += dt * (5 + ctx.speed * 0.62);
      spec.animate(mode, { ...ctx, runPhase }, time, deadT);
    },
  };
}

export const PROC_IDS = Object.keys(BUILDERS);
