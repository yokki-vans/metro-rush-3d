// Boot, game loop, camera, input, UI glue, FPS governor.
import * as THREE from 'three';
import { makeAtlas, makeWindows, makeGlow, makeShadow, makeSpeedlines } from './atlas.js';
import { curveUniform } from './curveworld.js';
import { World, LANE_W } from './world.js';
import { Player } from './player.js';
import { Sky } from './sky.js';
import { FX } from './fx.js';
import { AudioSys } from './audio.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
let dprCap = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dprCap);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 900);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.75 ? 74 : camera.aspect < 1.25 ? 66 : 58;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------- systems
const tex = {
  atlas: makeAtlas(), glow: makeGlow(), shadow: makeShadow(), lines: makeSpeedlines(),
};
[tex.windows, tex.windowsE] = makeWindows();

const sky = new Sky(scene);
const world = new World(scene, tex);
const player = new Player(scene, tex.shadow);
const fx = new FX(scene);
const audio = new AudioSys();

sky.onThunder = (d) => audio.thunder(d);
world.onHorn = () => audio.horn();

// speed lines cylinder around camera
const speedLines = (() => {
  const g = new THREE.CylinderGeometry(2.6, 2.6, 7, 18, 1, true);
  const m = new THREE.MeshBasicMaterial({
    map: tex.lines, transparent: true, opacity: 0, side: THREE.BackSide,
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  tex.lines.repeat.set(3, 1);
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = Math.PI / 2;
  mesh.renderOrder = 50;
  mesh.frustumCulled = false;
  camera.add(mesh);
  mesh.position.set(0, 0, -2.5);
  scene.add(camera);
  return mesh;
})();

// --------------------------------------------------------------------- state
const ST = { LOADING: 0, TITLE: 1, RUN: 2, DEAD: 3 };
const GHOST = new URLSearchParams(location.search).has('ghost');
// localStorage бросает исключения в приватном режиме Safari — не дать этому уронить игру
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
let state = ST.LOADING;
let dist = 0, speed = 0, score = 0, coinsGot = 0, best = +store.get('mr_best', 0);
let timeAlive = 0, deadT = 0, slowmo = 1, milestone = 500, paused = false;
let camYaw = 0, runT = 0, tunnelF = 0;

$('bestVal').textContent = best;

function startRun() {
  world.reset();
  player.reset();
  dist = 0; speed = 8.5; score = 0; coinsGot = 0; timeAlive = 0; milestone = 500; slowmo = 1; tunnelF = 0;
  player.startRun();
  $('score').textContent = '0';
  $('coins').textContent = '0';
  state = ST.RUN;
  $('title').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('hud').classList.remove('hidden');
  audio.unlock();
  audio.startMusic();
}

function die() {
  state = ST.DEAD;
  deadT = 0; slowmo = 0.22;
  player.die();
  audio.crash();
  audio.gameover();
  audio.stopMusic();
  fx.shake(1);
  fx.burst(new THREE.Vector3(player.x, player.y + 1, 0), 0xff7733, 26, 7, 0.8, 0.9, 8);
  fx.burst(new THREE.Vector3(player.x, player.y + 0.6, 0), 0xcccccc, 14, 5, 0.6, 0.7, 6);
  if (navigator.vibrate) navigator.vibrate(120);
  best = Math.max(best, Math.floor(score));
  store.set('mr_best', best);
}

function showGameOver() {
  $('goScore').textContent = Math.floor(score);
  $('goCoins').textContent = coinsGot;
  $('goBest').textContent = best;
  $('gameover').classList.remove('hidden');
  $('hud').classList.add('hidden');
}

// --------------------------------------------------------------------- input
function gesture(dir) {
  if (state === ST.TITLE) { startRun(); return; }
  if (state === ST.DEAD) { if (deadT > 1.0) startRun(); return; }
  if (state !== ST.RUN || paused) return;
  if (dir === 'L' || dir === 'R') {
    if (player.steer(dir === 'L' ? -1 : 1)) audio.swipe();
  } else if (dir === 'U') {
    if (player.jump()) { audio.jump(); fx.dust(new THREE.Vector3(player.x, player.y, 0), 4); }
  } else if (dir === 'D') {
    if (player.grounded) { if (player.roll()) audio.roll(); }
    else if (player.fastFall()) audio.swipe();
  }
}

let tStart = null;
const TH = 26;
renderer.domElement.addEventListener('pointerdown', (e) => {
  tStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!tStart) return;
  const dx = e.clientX - tStart.x, dy = e.clientY - tStart.y;
  if (Math.abs(dx) > TH || Math.abs(dy) > TH) {
    gesture(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
    tStart = { x: e.clientX, y: e.clientY, t: tStart.t, moved: true };
  }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (tStart && !tStart.moved && performance.now() - tStart.t < 250) {
    if (state === ST.RUN) gesture('U'); else gesture('TAP');
  }
  tStart = null;
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const map = {
    ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R',
    ArrowUp: 'U', KeyW: 'U', Space: 'U', ArrowDown: 'D', KeyS: 'D',
  };
  if (map[e.code]) { e.preventDefault(); gesture(map[e.code]); }
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyM') toggleMute();
});

function togglePause() {
  if (state !== ST.RUN) return;
  paused = !paused;
  $('pauseBtn').textContent = paused ? '▶' : 'II';
  $('pausedLbl').classList.toggle('hidden', !paused);
  audio.setAmbPaused(paused);
  if (paused) audio.stopMusic(); else { audio.unlock(); audio.startMusic(); }
}
function toggleMute() {
  audio.unlock();
  audio.setMuted(!audio.muted);
  $('muteBtn').textContent = audio.muted ? '🔇' : '🔊';
  $('muteBtn2').textContent = audio.muted ? '🔇' : '🔊';
}
$('pauseBtn').addEventListener('pointerup', (e) => { e.stopPropagation(); togglePause(); });
for (const id of ['muteBtn', 'muteBtn2']) {
  $(id).addEventListener('pointerup', (e) => { e.stopPropagation(); toggleMute(); });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === ST.RUN && !paused) togglePause();
});

// --------------------------------------------------------------------- камера
const camPos = new THREE.Vector3(0, 3.4, 6.4);
const camLook = new THREE.Vector3(0, 1.4, -10);
function updateCamera(dt, t) {
  if (state === ST.TITLE || state === ST.LOADING) {
    camYaw += dt * 0.22;
    const r = 6.5;
    camPos.lerp(new THREE.Vector3(Math.sin(camYaw) * r, 2.4 + Math.sin(t * 0.4) * 0.5, Math.cos(camYaw) * r), 1 - Math.exp(-2 * dt));
    camera.position.copy(camPos);
    camera.lookAt(0, 1.2, 0);
  } else {
    const px = player.x, py = player.y;
    const target = new THREE.Vector3(px * 0.55, 3.15 + py * 0.36, 6.2);
    camPos.lerp(target, 1 - Math.exp(-7 * dt));
    camera.position.copy(camPos);
    camLook.lerp(new THREE.Vector3(px * 0.75, 1.25 + py * 0.35, -9), 1 - Math.exp(-9 * dt));
    camera.lookAt(camLook);
    camera.position.y += Math.sin(runT * 11) * 0.018 * Math.min(1, speed / 14);
  }
  fx.applyShake(camera, t);
}

// ------------------------------------------------------------------ FPS + dpr
// Гувернёр калибруется по пиковому fps устройства: на 120-герцовом экране
// просадка до ~85 уже считается поводом снизить разрешение, на 60-герцовом — нет.
let fpsAcc = 0, fpsN = 0, fpsShown = 0, govT = 0, fpsPeak = 0;
function fpsTick(dt) {
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) {
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsPeak = Math.max(fpsPeak, fpsShown);
    $('fps').textContent = fpsShown;
    fpsAcc = 0; fpsN = 0;
  }
  govT += dt;
  if (govT > 3) {
    govT = 0;
    const devMax = Math.min(window.devicePixelRatio || 1, 2);
    const lowThr = fpsPeak >= 110 ? 88 : fpsPeak >= 80 ? 65 : 50;
    if (fpsShown && fpsShown < lowThr && dprCap > 1) {
      dprCap = Math.max(1, dprCap - 0.25);
      renderer.setPixelRatio(dprCap);
    } else if (fpsShown > lowThr + 24 && dprCap < devMax) {
      dprCap = Math.min(dprCap + 0.25, devMax);
      renderer.setPixelRatio(dprCap);
    }
  }
}

// --------------------------------------------------------------------- цикл
let last = performance.now();
const camWorld = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  fpsTick(dt);
  if (paused) { renderer.render(scene, camera); return; }

  const t = now / 1000;
  // slow-mo on death
  if (state === ST.DEAD) {
    deadT += dt;
    slowmo += (1 - slowmo) * Math.min(1, dt * 1.2);
    if (deadT > 1.05 && $('gameover').classList.contains('hidden')) showGameOver();
  }
  const gdt = dt * (state === ST.DEAD ? slowmo : 1);

  // curve wander — the "running around a corner" feel
  const cT = Math.sin(t * 0.10) * 0.9 + Math.sin(t * 0.041 + 1.7) * 0.6;
  curveUniform.value.x += ((cT * 0.0011) - curveUniform.value.x) * Math.min(1, dt * 0.5);
  curveUniform.value.y = -0.00050 + Math.sin(t * 0.07) * 0.00012;

  let worldDelta = 0;
  if (state === ST.RUN) {
    timeAlive += gdt;
    runT += gdt * speed * 0.12;
    speed = Math.min(23, 8.5 + timeAlive * 0.16 + dist * 0.0012);
    const prev = dist;
    dist += speed * gdt;
    worldDelta = dist - prev;
    score += speed * gdt + 0;

    if (score >= milestone) {
      milestone += 500;
      audio.milestone();
      fx.confetti(new THREE.Vector3(player.x, 1, -3));
      toast(`${Math.floor(score)}!`);
    }
  }

  // плавный вход/выход тоннеля, чтобы туман не «хлопал» на портале
  tunnelF += (world.inTunnel(dist) - tunnelF) * Math.min(1, dt * 3);
  const env = sky.update(dt, camera, tunnelF);
  const info = world.update(gdt, dist, speed, env);

  player.update(gdt, world, dist, speed, {
    onLand: () => { audio.land(); fx.dust(new THREE.Vector3(player.x, player.y + 0.05, 0), 6); },
    onStep: () => fx.dust(new THREE.Vector3(player.x, player.y + 0.02, 0), 1),
    onJump: () => { audio.jump(); fx.dust(new THREE.Vector3(player.x, player.y, 0), 4); },
    onRoll: () => audio.roll(),
  });

  if (state === ST.RUN) {
    // coins
    const got = world.collect(dist, player.x, player.y);
    if (got) {
      coinsGot += got;
      score += got * 25;
      audio.coin();
      fx.burst(new THREE.Vector3(player.x, player.y + 1.1, -0.2), 0xffd34d, 8 * got, 3.4, 0.5, 0.5, 3);
      $('coins').textContent = coinsGot;
    }
    // collision (?ghost=1 disables death — debug fly-through)
    if (!GHOST && world.collide(dist, player.x, player.y, player.rolling > 0)) die();
    $('score').textContent = Math.floor(score);
  }

  updateCamera(dt, t);
  speedLines.material.opacity = state === ST.RUN ? Math.max(0, (speed - 15) / 9) * 0.3 : 0;
  tex.lines.offset.y -= dt * speed * 0.09;

  fx.update(gdt, worldDelta);
  audio.update(dt, { speed: state === ST.RUN ? speed : 0, rain: env.rain, trainDist: info.trainDist, trainPan: info.trainPan });

  renderer.render(scene, camera);
}

let toastT = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), 1400);
}

// ---------------------------------------------------------------------- boot
player.load().then(() => {
  state = ST.TITLE;
  player.idleDance();
  $('loading').classList.add('hidden');
  $('title').classList.remove('hidden');
}).catch(err => {
  $('loading').textContent = 'Ошибка загрузки: ' + err.message;
  console.error(err);
});

// unlock audio at the very first interaction anywhere
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// debug handle
window.__dbg = { player, world, sky, camera, scene, get state() { return state; }, get dist() { return dist; }, get speed() { return speed; } };

requestAnimationFrame((n) => { last = n; requestAnimationFrame(frame); });
