// Boot, game loop, camera, input, UI glue, FPS governor.
import * as THREE from 'three';
import { makeAtlas, makeWindows, makeGlow, makeShadow, makeSpeedlines, makeGround, makeCoin } from './atlas.js';
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

let baseFov = 64;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  baseFov = camera.aspect < 0.75 ? 74 : camera.aspect < 1.25 ? 66 : 58;
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------- systems
const tex = {
  atlas: makeAtlas(), glow: makeGlow(), shadow: makeShadow(), lines: makeSpeedlines(),
  ground: makeGround(), coin: makeCoin(),
};
[tex.windows, tex.windowsE] = makeWindows('glass');
[tex.windowsB, tex.windowsBE] = makeWindows('brick');

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

// ------------------------------------------------- мета: банк, скины, лидеры
const jget = (k, d) => { try { return JSON.parse(store.get(k, JSON.stringify(d))); } catch { return d; } };
let bank = +store.get('mr_bank', 0);
let playerName = store.get('mr_name', 'БЕГУН');
let board = jget('mr_board', []);
let owned = jget('mr_owned', ['classic']);
let curSkin = store.get('mr_skin', 'classic');
let lastRank = -1;

const SKINS = [
  { id: 'classic', name: 'РОБО', price: 0, prev: ['#d84b4b', '#ececec'] },
  { id: 'neon', name: 'НЕОН', price: 250, primary: 0x1a2440, secondary: 0x2a3a60, glow: 0x35e0ff, glowInt: 0.55, prev: ['#1a2440', '#35e0ff'] },
  { id: 'emerald', name: 'ИЗУМРУД', price: 400, primary: 0x12814b, secondary: 0xcdebd8, glow: 0x2bff9d, glowInt: 0.55, prev: ['#12814b', '#7dffc4'] },
  { id: 'gold', name: 'ЗОЛОТО', price: 550, primary: 0xcf9a12, secondary: 0xf7dd8a, glow: 0xffa400, glowInt: 0.5, prev: ['#cf9a12', '#ffe9a0'] },
  { id: 'lava', name: 'ЛАВА', price: 700, primary: 0x381108, secondary: 0x6b2410, glow: 0xff5a1f, glowInt: 0.7, prev: ['#381108', '#ff5a1f'] },
  { id: 'ghost', name: 'ПРИЗРАК', price: 900, primary: 0xbcd8ff, secondary: 0xe2f1ff, glow: 0x9fc8ff, glowInt: 0.75, opacity: 0.55, prev: ['#9fc8ff', '#f0f8ff'] },
];

// бустеры текущего забега
const boost = { magnet: 0, x2: 0, boot: 0, shield: false };
let invulnT = 0, magnetFxT = 0;

$('bestVal').textContent = best;

function startRun() {
  world.reset();
  player.reset();
  dist = 0; speed = 8.5; score = 0; coinsGot = 0; timeAlive = 0; milestone = 500; slowmo = 1; tunnelF = 0; camGround = 0;
  boost.magnet = 0; boost.x2 = 0; boost.boot = 0; boost.shield = false;
  invulnT = 0;
  player.setShield(false);
  player.startRun();
  $('score').textContent = '0';
  $('coins').textContent = '0';
  state = ST.RUN;
  $('title').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('shop').classList.add('hidden');
  $('board').classList.add('hidden');
  $('hud').classList.remove('hidden');
  audio.unlock();
  audio.startMusic();
}

const uiOpen = () => !$('shop').classList.contains('hidden') || !$('board').classList.contains('hidden');

function die() {
  state = ST.DEAD;
  deadT = 0; slowmo = 0.22;
  if (player.model) player.model.visible = true;   // не умереть «невидимкой» в кадре мигания
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
  // копилка + таблица лидеров
  bank += coinsGot;
  store.set('mr_bank', bank);
  const entry = { n: playerName, s: Math.floor(score), c: coinsGot, t: timeAlive | 0 };
  board.push(entry);
  board.sort((a, b) => b.s - a.s);
  board = board.slice(0, 10);
  lastRank = board.indexOf(entry);
  store.set('mr_board', JSON.stringify(board));
}

function showGameOver() {
  $('goScore').textContent = Math.floor(score);
  $('goCoins').textContent = coinsGot;
  $('goBest').textContent = best;
  $('goBank').textContent = bank;
  // мини-топ-5 с подсветкой свежего результата
  $('goBoard').innerHTML = board.slice(0, 5).map((e, i) =>
    `<div class="brow${i === lastRank ? ' me' : ''}"><b>${i + 1}</b><span>${esc(e.n)}</span><i>${e.s}</i></div>`
  ).join('');
  $('gameover').classList.remove('hidden');
  $('hud').classList.add('hidden');
}

const esc = (s) => String(s).replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

// --------------------------------------------------------------------- input
function gesture(dir) {
  if (state === ST.TITLE) { if (!uiOpen()) startRun(); return; }
  if (state === ST.DEAD) { if (deadT > 1.0 && !uiOpen()) startRun(); return; }
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

// один палец — ровно ОДИН жест: после срабатывания свайп блокируется до
// отпускания, иначе длинный свайп считывался как два сдвига подряд
let tStart = null;
const TH = 28;
renderer.domElement.addEventListener('pointerdown', (e) => {
  tStart = { x: e.clientX, y: e.clientY, t: performance.now(), fired: false };
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!tStart || tStart.fired) return;
  const dx = e.clientX - tStart.x, dy = e.clientY - tStart.y;
  if (Math.abs(dx) > TH || Math.abs(dy) > TH) {
    tStart.fired = true;
    gesture(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
  }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (tStart && !tStart.fired && performance.now() - tStart.t < 250) {
    if (state === ST.RUN) gesture('U'); else gesture('TAP');
  }
  tStart = null;
});
renderer.domElement.addEventListener('pointercancel', () => { tStart = null; });
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
let camGround = 0;     // сглаженная высота опоры (земля/крыша поезда)
function updateCamera(dt, t) {
  if (state === ST.TITLE || state === ST.LOADING) {
    camYaw += dt * 0.22;
    const r = 6.5;
    camPos.lerp(new THREE.Vector3(Math.sin(camYaw) * r, 2.4 + Math.sin(t * 0.4) * 0.5, Math.cos(camYaw) * r), 1 - Math.exp(-2 * dt));
    camera.position.copy(camPos);
    camera.lookAt(0, 1.2, 0);
  } else {
    const px = player.x, py = player.y;
    // камера следует за высотой ОПОРЫ: поднимается на крышах поездов,
    // а прыжок добавляет лишь лёгкий подъём
    const gh = world.groundHeight(px, dist);
    camGround += (gh - camGround) * (1 - Math.exp(-5 * dt));
    const air = Math.max(0, py - gh);
    const target = new THREE.Vector3(px * 0.55, 3.15 + camGround * 0.85 + air * 0.22, 6.2);
    camPos.lerp(target, 1 - Math.exp(-7 * dt));
    camera.position.copy(camPos);
    camLook.lerp(new THREE.Vector3(px * 0.75, 1.25 + camGround * 0.8 + air * 0.3, -9), 1 - Math.exp(-9 * dt));
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

    // бустеры: таймеры и эффекты
    boost.magnet = Math.max(0, boost.magnet - gdt);
    boost.x2 = Math.max(0, boost.x2 - gdt);
    boost.boot = Math.max(0, boost.boot - gdt);
    invulnT = Math.max(0, invulnT - gdt);
    player.boostJump = boost.boot > 0;
    player.setShield(boost.shield);
    const mult = boost.x2 > 0 ? 2 : 1;
    score += speed * gdt * mult;

    // магнит: лёгкие искры вокруг игрока
    if (boost.magnet > 0) {
      magnetFxT -= gdt;
      if (magnetFxT <= 0) {
        magnetFxT = 0.1;
        const a = Math.random() * Math.PI * 2;
        fx.spawn(player.x + Math.cos(a) * 1.3, player.y + 0.6 + Math.random() * 0.9, Math.sin(a) * 0.8,
          -Math.cos(a) * 2.5, 0.6, 0, new THREE.Color(0x6fe0ff), 0.5, 0.35, 0);
      }
    }
    updateBoostHud();

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
    const mult = boost.x2 > 0 ? 2 : 1;
    // coins (магнит расширяет радиус сбора)
    const got = world.collect(dist, player.x, player.y, boost.magnet > 0 ? 3.1 : 0);
    if (got) {
      coinsGot += got;
      score += got * 25 * mult;
      audio.coin();
      fx.burst(new THREE.Vector3(player.x, player.y + 1.1, -0.2), 0xffd34d, 8 * got, 3.4, 0.5, 0.5, 3);
      $('coins').textContent = coinsGot;
      const cp = $('coinPill');
      cp.classList.remove('bump'); void cp.offsetWidth; cp.classList.add('bump');
    }
    // бустер-пикап
    const pkType = world.collectPickup(dist, player.x, player.y);
    if (pkType) {
      const col = world.pickupDefs[pkType].color;
      audio.pickup(pkType);
      fx.burst(new THREE.Vector3(player.x, player.y + 1.1, 0), col, 20, 4.5, 0.6, 0.7, 4);
      fx.shake(0.12);
      if (pkType === 'magnet') boost.magnet = 8;
      else if (pkType === 'x2') boost.x2 = 10;
      else if (pkType === 'boot') boost.boot = 8;
      else if (pkType === 'shield') boost.shield = true;
      toast({ magnet: '🧲 МАГНИТ!', x2: '×2 ОЧКИ!', boot: '👟 ПРЫЖОК!', shield: '🛡 ЩИТ!' }[pkType]);
    }
    // collision (?ghost=1 disables death — debug fly-through)
    if (!GHOST && invulnT <= 0 && world.collide(dist, player.x, player.y, player.rolling > 0)) {
      if (boost.shield) {
        // щит спасает: хлопок, неуязвимость и прыжок на крышу
        boost.shield = false;
        invulnT = 1.25;
        player.setShield(false);
        player.saveHop();
        audio.shieldPop();
        fx.shake(0.3);
        fx.burst(new THREE.Vector3(player.x, player.y + 1, 0), 0x6fc4ff, 26, 6, 0.7, 0.7, 5);
        if (navigator.vibrate) navigator.vibrate(60);
      } else {
        die();
      }
    }
    // мигание во время неуязвимости
    if (player.model) player.model.visible = invulnT > 0 ? (Math.floor(t * 14) % 2 === 0) : true;
    $('score').textContent = Math.floor(score);
  }

  updateCamera(dt, t);
  // FOV-кик от скорости — ощущение разгона
  const fovT = baseFov + (state === ST.RUN ? Math.min(7, Math.max(0, (speed - 9) * 0.5)) : 0);
  if (Math.abs(camera.fov - fovT) > 0.04) {
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 2.5);
    camera.updateProjectionMatrix();
  }
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

// --------------------------------------------------------- мета-UI: магазин/лидеры
const BOOST_DUR = { magnet: 8, x2: 10, boot: 8 };
function updateBoostHud() {
  for (const k of ['magnet', 'x2', 'boot']) {
    const el = $('bc-' + k);
    const v = boost[k];
    el.classList.toggle('hidden', v <= 0);
    if (v > 0) el.querySelector('i').style.width = (v / BOOST_DUR[k] * 100).toFixed(1) + '%';
  }
  $('bc-shield').classList.toggle('hidden', !boost.shield);
}

function applySkinById(id) {
  const def = SKINS.find(s => s.id === id) || SKINS[0];
  curSkin = def.id;
  store.set('mr_skin', curSkin);
  player.applySkin(def);
}

function renderShop() {
  $('bankVal2').textContent = bank;
  $('shopGrid').innerHTML = SKINS.map(s => {
    const own = owned.includes(s.id), sel = curSkin === s.id;
    const status = sel ? '✓ ВЫБРАН' : own ? 'ВЫБРАТЬ' : `🪙 ${s.price}`;
    return `<div class="skin${sel ? ' sel' : ''}${own ? '' : ' locked'}" data-id="${s.id}">
      <div class="chip" style="background:linear-gradient(135deg, ${s.prev[0]}, ${s.prev[1]})"></div>
      <b>${s.name}</b><span>${status}</span></div>`;
  }).join('');
}

function renderBoard() {
  $('boardName').textContent = playerName;
  $('boardList').innerHTML = board.length
    ? board.map((e, i) =>
      `<div class="brow${i === lastRank ? ' me' : ''}"><b>${i + 1}</b><span>${esc(e.n)}</span><i>${e.s}</i></div>`).join('')
    : '<div class="bempty">Пока пусто — пробеги первый забег!</div>';
}

$('shopGrid').addEventListener('pointerup', (e) => {
  const cell = e.target.closest('.skin');
  if (!cell) return;
  audio.unlock();
  const def = SKINS.find(s => s.id === cell.dataset.id);
  if (owned.includes(def.id)) {
    applySkinById(def.id);
    audio.click();
  } else if (bank >= def.price) {
    bank -= def.price;
    store.set('mr_bank', bank);
    owned.push(def.id);
    store.set('mr_owned', JSON.stringify(owned));
    applySkinById(def.id);
    audio.buy();
    $('bankVal').textContent = bank;
  } else {
    audio.click();
    cell.classList.remove('deny'); void cell.offsetWidth; cell.classList.add('deny');
  }
  renderShop();
});

$('btnShop').addEventListener('pointerup', () => { audio.unlock(); audio.click(); renderShop(); $('shop').classList.remove('hidden'); });
$('btnBoard').addEventListener('pointerup', () => { audio.unlock(); audio.click(); renderBoard(); $('board').classList.remove('hidden'); });
$('shopClose').addEventListener('pointerup', () => { audio.click(); $('shop').classList.add('hidden'); });
$('boardClose').addEventListener('pointerup', () => { audio.click(); $('board').classList.add('hidden'); });
$('goBoardBtn').addEventListener('pointerup', (e) => { e.stopPropagation(); audio.click(); renderBoard(); $('board').classList.remove('hidden'); });
$('goShopBtn').addEventListener('pointerup', (e) => { e.stopPropagation(); audio.click(); renderShop(); $('shop').classList.remove('hidden'); });
$('btnRename').addEventListener('pointerup', () => {
  const nm = prompt('Имя для таблицы лидеров:', playerName);
  if (nm && nm.trim()) {
    playerName = nm.trim().slice(0, 14);
    store.set('mr_name', playerName);
    renderBoard();
  }
});
$('bankVal').textContent = bank;

// ---------------------------------------------------------------------- boot
player.load().then(() => {
  state = ST.TITLE;
  applySkinById(curSkin);
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
window.__dbg = { player, world, sky, camera, scene, renderer, get state() { return state; }, get dist() { return dist; }, get speed() { return speed; } };

requestAnimationFrame((n) => { last = n; requestAnimationFrame(frame); });
