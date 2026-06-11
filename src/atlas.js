// Procedural canvas textures: atlas for props/trains/ads, tiling building windows,
// sprites for glows/shadows. All generated at boot — zero downloads, zero licenses.
import * as THREE from 'three';

// Safari ≤15 has no ctx.roundRect — polyfill so atlas generation can't crash boot
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// ---------------------------------------------------------------- atlas 1024
// Regions in pixels; UV helper converts with a small inset against bleeding.
export const REG = {
  plain:      { x: 8,   y: 8,   w: 48,  h: 48 },
  hazard:     { x: 64,  y: 0,   w: 256, h: 64 },
  trainSide:  { x: 0,   y: 64,  w: 512, h: 256 },
  trainFront: { x: 512, y: 64,  w: 256, h: 256 },
  ad0:        { x: 0,   y: 320, w: 256, h: 128 },
  ad1:        { x: 256, y: 320, w: 256, h: 128 },
  ad2:        { x: 0,   y: 448, w: 256, h: 128 },
  ad3:        { x: 256, y: 448, w: 256, h: 128 },
  sign:       { x: 512, y: 320, w: 256, h: 128 },
  door:       { x: 768, y: 64,  w: 128, h: 256 },
  concrete:   { x: 512, y: 448, w: 128, h: 128 },
  icoMagnet:  { x: 640, y: 448, w: 96,  h: 96 },
  icoShield:  { x: 736, y: 448, w: 96,  h: 96 },
  icoX2:      { x: 832, y: 448, w: 96,  h: 96 },
  icoBoot:    { x: 640, y: 544, w: 96,  h: 96 },
  icoJet:     { x: 736, y: 544, w: 96,  h: 96 },
  icoSlow:    { x: 832, y: 544, w: 96,  h: 96 },
  icoBag:     { x: 640, y: 640, w: 96,  h: 96 },
  icoStar:    { x: 736, y: 640, w: 96,  h: 96 },
  wood:       { x: 0,   y: 576, w: 256, h: 64 },
  neonBar:    { x: 0,   y: 648, w: 256, h: 64 },
};

// 4-ступенчатый градиент для toon-шейдинга (MeshToonMaterial.gradientMap)
export function makeToonGradient() {
  const data = new Uint8Array([110, 110, 110, 255, 170, 170, 170, 255, 222, 222, 222, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export function makeAtlas() {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 1024);

  // hazard stripes (yellow/black diagonal)
  {
    const r = REG.hazard;
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    g.fillStyle = '#ffc91f'; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#1c1c22';
    for (let i = -2; i < 12; i++) {
      g.beginPath();
      g.moveTo(r.x + i * 48, r.y + r.h); g.lineTo(r.x + i * 48 + 32, r.y + r.h);
      g.lineTo(r.x + i * 48 + 32 + r.h, r.y); g.lineTo(r.x + i * 48 + r.h, r.y);
      g.fill();
    }
    g.restore();
  }

  // train side: мультяшный вагон — белый корпус (тонируется), круглые окна, контуры
  {
    const r = REG.trainSide;
    g.fillStyle = '#f6f6f8'; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#dcdce2'; g.fillRect(r.x, r.y, r.w, 20);                  // roof line
    g.fillStyle = '#2b2c34';
    g.beginPath(); g.roundRect(r.x - 6, r.y + r.h - 36, r.w + 12, 42, 10); g.fill(); // skirt
    g.fillStyle = '#c2c4cc'; g.fillRect(r.x, r.y + r.h - 42, r.w, 7);
    // окна — отдельные скруглённые иллюминаторы с толстой обводкой
    for (let i = 0; i < 6; i++) {
      const wx = r.x + 18 + i * 82;
      g.fillStyle = '#23262f';
      g.beginPath(); g.roundRect(wx - 5, r.y + 49, 72, 66, 18); g.fill();
      const gr = g.createLinearGradient(wx, r.y + 54, wx + 62, r.y + 110);
      gr.addColorStop(0, '#aef0ff'); gr.addColorStop(.6, '#5fb2e8'); gr.addColorStop(1, '#3f86c8');
      g.fillStyle = gr;
      g.beginPath(); g.roundRect(wx, r.y + 54, 62, 56, 14); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath(); g.roundRect(wx + 6, r.y + 59, 20, 22, 8); g.fill();
    }
    // двери — скруглённые, с окошками
    for (const dx of [120, 330]) {
      g.fillStyle = '#3a3d48';
      g.beginPath(); g.roundRect(r.x + dx - 4, r.y + 42, 64, r.h - 76, 14); g.fill();
      g.fillStyle = '#9aa0ac';
      g.beginPath(); g.roundRect(r.x + dx, r.y + 46, 56, r.h - 84, 11); g.fill();
      g.fillStyle = '#5fb2e8';
      g.beginPath(); g.roundRect(r.x + dx + 7, r.y + 56, 17, 42, 7); g.fill();
      g.beginPath(); g.roundRect(r.x + dx + 32, r.y + 56, 17, 42, 7); g.fill();
      g.strokeStyle = '#3a3d48'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(r.x + dx + 28, r.y + 48); g.lineTo(r.x + dx + 28, r.y + r.h - 40); g.stroke();
    }
    // волнистая акцентная полоса (тонируется в цвет состава)
    g.fillStyle = '#9a9aa2';
    g.beginPath();
    g.moveTo(r.x, r.y + 124);
    for (let px = 0; px <= r.w; px += 16) g.lineTo(r.x + px, r.y + 124 + Math.sin(px * 0.05) * 3);
    for (let px = r.w; px >= 0; px -= 16) g.lineTo(r.x + px, r.y + 142 + Math.sin(px * 0.05) * 3);
    g.closePath(); g.fill();
  }

  // train front: windshield + lights
  {
    const r = REG.trainFront;
    g.fillStyle = '#ececef'; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#33343c'; g.fillRect(r.x, r.y + r.h - 30, r.w, 30);
    g.fillStyle = '#10141f';
    g.beginPath();
    g.roundRect(r.x + 28, r.y + 34, r.w - 56, 86, 14); g.fill();
    g.fillStyle = '#3c5070';
    g.beginPath(); g.roundRect(r.x + 36, r.y + 42, r.w - 72, 70, 10); g.fill();
    g.fillStyle = '#ffe9a8';                                   // headlights
    for (const lx of [44, r.w - 84]) {
      g.beginPath(); g.roundRect(r.x + lx, r.y + 150, 40, 26, 8); g.fill();
    }
    g.fillStyle = '#c03c3c';
    g.fillRect(r.x + 100, r.y + 154, r.w - 200, 18);           // mid red light
  }

  // door (building entrance)
  {
    const r = REG.door;
    g.fillStyle = '#3a3f4a'; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#202531'; g.fillRect(r.x + 14, r.y + 30, r.w - 28, r.h - 44);
    g.fillStyle = '#778'; g.fillRect(r.x + 14, r.y + 30, r.w - 28, 8);
  }

  // concrete (subtle noise)
  {
    const r = REG.concrete;
    g.fillStyle = '#b9bcc2'; g.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < 380; i++) {
      g.fillStyle = `rgba(${Math.random() > .5 ? '255,255,255' : '20,24,30'},${Math.random() * 0.09})`;
      g.fillRect(r.x + Math.random() * r.w, r.y + Math.random() * r.h, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
  }

  // overhead sign (route board with arrows)
  {
    const r = REG.sign;
    g.fillStyle = '#0d4f9e'; g.beginPath(); g.roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 10); g.fill();
    g.strokeStyle = '#e8eef8'; g.lineWidth = 5; g.strokeRect(r.x + 12, r.y + 12, r.w - 24, r.h - 24);
    g.fillStyle = '#ffffff'; g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('⬇ M ⬇', r.x + r.w / 2, r.y + r.h / 2 + 2);
  }

  // billboards — original fake ads
  const ads = [
    ['#ff5630', '#ffffff', 'ROBO-COLA', 'заряжайся!'],
    ['#16c172', '#06231a', 'RUN+', 'беги быстрее'],
    ['#ffd23f', '#3a2a00', 'КОФЕ 24/7', 'станция «Бодрость»'],
    ['#7b5cff', '#ffffff', 'NEON FM', '103.7 МГц'],
  ];
  [REG.ad0, REG.ad1, REG.ad2, REG.ad3].forEach((r, i) => {
    const [bg, fg, big, small] = ads[i];
    g.fillStyle = bg; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = 'rgba(255,255,255,.14)';
    g.beginPath(); g.arc(r.x + r.w * 0.82, r.y + r.h * 0.2, 46, 0, 7); g.fill();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 44px sans-serif'; g.fillText(big, r.x + r.w / 2, r.y + r.h * 0.4);
    g.font = 'bold 22px sans-serif'; g.fillText(small, r.x + r.w / 2, r.y + r.h * 0.74);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 8; g.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
  });

  // booster icons: rounded color tile + bold glyph
  const ico = (r, bg, draw) => {
    g.save();
    g.fillStyle = bg;
    g.beginPath(); g.roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 20); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 5;
    g.beginPath(); g.roundRect(r.x + 7, r.y + 7, r.w - 14, r.h - 14, 17); g.stroke();
    g.translate(r.x + r.w / 2, r.y + r.h / 2);
    draw();
    g.restore();
  };
  ico(REG.icoMagnet, '#d63b4f', () => {            // магнит-подкова
    g.strokeStyle = '#ffffff'; g.lineWidth = 16; g.lineCap = 'butt';
    g.beginPath(); g.arc(0, -4, 22, Math.PI, 0); g.stroke();
    g.strokeStyle = '#ffd7dd';
    g.fillStyle = '#ffffff';
    g.fillRect(-30, -6, 16, 22); g.fillRect(14, -6, 16, 22);
    g.fillStyle = '#9fe8ff';
    g.fillRect(-30, 16, 16, 8); g.fillRect(14, 16, 16, 8);
  });
  ico(REG.icoShield, '#2f80e0', () => {            // щит
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -26); g.lineTo(22, -16); g.lineTo(22, 4);
    g.quadraticCurveTo(22, 22, 0, 30);
    g.quadraticCurveTo(-22, 22, -22, 4);
    g.lineTo(-22, -16); g.closePath(); g.fill();
    g.fillStyle = '#2f80e0';
    g.beginPath(); g.moveTo(0, -16); g.lineTo(13, -10) ; g.lineTo(13, 4); g.quadraticCurveTo(13, 15, 0, 20); g.closePath(); g.fill();
  });
  ico(REG.icoX2, '#e8a020', () => {                // множитель
    g.fillStyle = '#ffffff'; g.font = 'bold 52px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('×2', 0, 2);
  });
  ico(REG.icoBoot, '#27ae60', () => {              // кроссовок-прыжок
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(-22, -2, 30, 16, 6); g.fill();
    g.beginPath(); g.roundRect(-22, -22, 14, 24, 6); g.fill();
    g.fillStyle = '#bdf5d2'; g.fillRect(-22, 10, 44, 6);
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(16, -20); g.lineTo(16, -6); g.moveTo(10, -13); g.lineTo(16, -6); g.lineTo(22, -13); g.stroke();
  });
  ico(REG.icoJet, '#8a4fff', () => {               // джетпак-ракета
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -28); g.quadraticCurveTo(14, -10, 10, 10); g.lineTo(-10, 10);
    g.quadraticCurveTo(-14, -10, 0, -28); g.fill();
    g.fillStyle = '#cdb5ff'; g.beginPath(); g.arc(0, -6, 6, 0, 7); g.fill();
    g.fillStyle = '#ffb13d';
    g.beginPath(); g.moveTo(-8, 12); g.lineTo(0, 28); g.lineTo(8, 12); g.closePath(); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(-10, 2); g.lineTo(-20, 14); g.lineTo(-10, 12); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(10, 2); g.lineTo(20, 14); g.lineTo(10, 12); g.closePath(); g.fill();
  });
  ico(REG.icoSlow, '#3aa8a0', () => {              // слоу-мо: песочные часы
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(-16, -24); g.lineTo(16, -24); g.lineTo(3, 0); g.lineTo(16, 24); g.lineTo(-16, 24); g.lineTo(-3, 0);
    g.closePath(); g.fill();
    g.fillStyle = '#bff0ec';
    g.beginPath(); g.moveTo(-9, -19); g.lineTo(9, -19); g.lineTo(0, -4); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(0, 8); g.lineTo(10, 21); g.lineTo(-10, 21); g.closePath(); g.fill();
  });
  ico(REG.icoBag, '#c98a1e', () => {               // мешок монет
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(0, 8, 18, 16, 0, 0, 7); g.fill();
    g.beginPath(); g.roundRect(-7, -22, 14, 12, 4); g.fill();
    g.fillStyle = '#ffe9a8'; g.font = 'bold 24px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🪙'.length ? '$' : '$', 0, 8);
  });
  ico(REG.icoStar, '#e8c020', () => {              // звезда очков
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 11 : 26, a = -Math.PI / 2 + i * Math.PI / 5;
      g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  });

  // деревянные доски (каньон)
  {
    const r = REG.wood;
    g.fillStyle = '#9a6a3a'; g.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < 4; i++) {
      const px = r.x + i * 64;
      g.fillStyle = ['#a8743f', '#91633a', '#a06d3c', '#8d5f34'][i];
      g.fillRect(px + 2, r.y + 2, 60, r.h - 4);
      g.strokeStyle = 'rgba(60,35,12,.8)'; g.lineWidth = 3;
      g.strokeRect(px + 2, r.y + 2, 60, r.h - 4);
      g.fillStyle = 'rgba(60,35,12,.6)';
      g.beginPath(); g.arc(px + 12, r.y + r.h / 2, 3, 0, 7); g.fill();
      g.beginPath(); g.arc(px + 52, r.y + r.h / 2, 3, 0, 7); g.fill();
      g.strokeStyle = 'rgba(60,35,12,.35)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(px + 8, r.y + 12 + i * 8); g.quadraticCurveTo(px + 30, r.y + 18 + i * 6, px + 56, r.y + 10 + i * 9); g.stroke();
    }
  }
  // неоновые полосы (неон-мир)
  {
    const r = REG.neonBar;
    g.fillStyle = '#14102a'; g.fillRect(r.x, r.y, r.w, r.h);
    const cols = ['#35e0ff', '#ff4fd8', '#35e0ff', '#b14fff'];
    for (let i = 0; i < 4; i++) {
      g.fillStyle = cols[i];
      g.beginPath(); g.roundRect(r.x + 8 + i * 62, r.y + 10, 48, r.h - 20, 10); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.roundRect(r.x + 16 + i * 62, r.y + 18, 32, r.h - 36, 6); g.fill();
    }
  }

  return tex(c);
}

// ------------------------------------------------ tiling ground noise (tinted)
export function makeGround() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 160 + (Math.random() * 96) | 0;
    g.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.35 + Math.random() * 0.5})`;
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * 128, Math.random() * 128, s, s);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(40,36,30,${0.06 + Math.random() * 0.1})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 1 + Math.random() * 3);
  }
  return tex(c, true);
}

// --------------------------------------------------------- coin face texture
export function makeCoin() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(50, 44, 8, 64, 64, 64);
  grad.addColorStop(0, '#fff3b0');
  grad.addColorStop(0.45, '#ffd34d');
  grad.addColorStop(0.8, '#e8a020');
  grad.addColorStop(1, '#b8761a');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(184,118,26,.9)'; g.lineWidth = 7;
  g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(255,243,176,.8)'; g.lineWidth = 3;
  g.beginPath(); g.arc(64, 64, 46, 0, 7); g.stroke();
  g.fillStyle = '#a8650f';
  g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('M', 64, 68);
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.beginPath(); g.ellipse(42, 36, 18, 9, -0.7, 0, 7); g.fill();
  return tex(c);
}

// ------------------------------------------------------------ cloud sprites
export function makeCloud() {
  const [c, g] = canvas(256, 128);
  g.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 14; i++) {
    const x = 40 + Math.random() * 176, y = 50 + Math.random() * 36;
    const r = 18 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.85)');
    gr.addColorStop(0.7, 'rgba(255,255,255,.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return tex(c);
}

// UV remap helpers ----------------------------------------------------------
const A = 1024;
export function regionUV(geo, r, inset = 3) {
  const uv = geo.attributes.uv;
  const u0 = (r.x + inset) / A, v0 = 1 - (r.y + r.h - inset) / A;
  const u1 = (r.x + r.w - inset) / A, v1 = 1 - (r.y + inset) / A;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  return geo;
}

// BoxGeometry faces order: +x,-x,+y,-y,+z,-z (4 verts each). Map per-face regions.
export function boxUV(geo, faces) {
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const uv = geo.attributes.uv;
  order.forEach((k, f) => {
    const r = faces[k] || faces.rest || REG.plain;
    const inset = 3;
    const u0 = (r.x + inset) / A, v0 = 1 - (r.y + r.h - inset) / A;
    const u1 = (r.x + r.w - inset) / A, v1 = 1 - (r.y + inset) / A;
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  });
  return geo;
}

// ------------------------------------------------------- building windows 256
// variant 'glass' — стеклянные башни; 'brick' — кирпич с меньшими окнами
export function makeWindows(variant = 'glass') {
  const [c, g] = canvas(256, 256);
  const [ce, ge] = canvas(256, 256);
  const brick = variant === 'brick';
  // wall: near-white (vertex tint gives the color)
  g.fillStyle = brick ? '#efe9e2' : '#f2f1ee'; g.fillRect(0, 0, 256, 256);
  if (brick) {
    // кирпичная кладка: ряды со смещением + швы
    const bh = 11, bw = 30;
    for (let row = 0; row * bh < 256; row++) {
      const off = (row % 2) * bw / 2;
      for (let x = -1; x * bw < 256 + bw; x++) {
        const shade = 0.82 + Math.random() * 0.26;
        g.fillStyle = `rgba(${(228 * shade) | 0},${(212 * shade) | 0},${(198 * shade) | 0},1)`;
        g.fillRect(x * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
      }
    }
  } else {
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(0,0,20,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
    }
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  const COLS = 4, ROWS = 4, cw = 256 / COLS, ch = 256 / ROWS;
  const m = brick ? 16 : 11, mv = brick ? 18 : 13;
  const rad = brick ? 7 : 9;                // мультяшные скругления
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const wx = x * cw + m, wy = y * ch + mv, ww = cw - m * 2, wh = ch - mv * 2;
      // толстая тёмная обводка-рамка
      g.fillStyle = brick ? '#5d4a3a' : '#2c3140';
      g.beginPath(); g.roundRect(wx - 5, wy - 5, ww + 10, wh + 10, rad + 3); g.fill();
      const grad = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      if (brick) { grad.addColorStop(0, '#7fd4e8'); grad.addColorStop(.55, '#4f9fc4'); grad.addColorStop(1, '#3a7ba0'); }
      else { grad.addColorStop(0, '#9fe3ff'); grad.addColorStop(.55, '#5fb2e8'); grad.addColorStop(1, '#3f86c8'); }
      g.fillStyle = grad;
      g.beginPath(); g.roundRect(wx, wy, ww, wh, rad); g.fill();
      // жирный мультяшный блик
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.roundRect(wx + 4, wy + 4, ww * 0.32, wh * 0.42, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.beginPath(); g.moveTo(wx + ww * .45, wy + wh); g.lineTo(wx + ww * .68, wy); g.lineTo(wx + ww * .82, wy); g.lineTo(wx + ww * .6, wy + wh); g.fill();
      if (brick) {                          // подоконник
        g.fillStyle = 'rgba(255,245,230,.85)';
        g.beginPath(); g.roundRect(wx - 7, wy + wh + 4, ww + 14, 5, 3); g.fill();
      }
      // emissive: ~half of the windows lit warm at night
      if (Math.random() < 0.52) {
        const warm = ['#ffd98a', '#ffc46b', '#fff2c4', '#ffb55e'][(Math.random() * 4) | 0];
        ge.fillStyle = warm;
        ge.beginPath(); ge.roundRect(wx, wy, ww, wh, rad); ge.fill();
        ge.fillStyle = 'rgba(0,0,0,0.35)';
        if (Math.random() < .4) ge.fillRect(wx, wy + wh / 2, ww, wh / 2);
      }
    }
  }
  return [tex(c, true), tex(ce, true)];
}

// ------------------------------------------------------------------- sprites
export function makeGlow() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,.85)');
  gr.addColorStop(0.6, 'rgba(255,255,255,.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return tex(c);
}

export function makeShadow() {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,8,.55)');
  gr.addColorStop(0.7, 'rgba(0,0,8,.28)');
  gr.addColorStop(1, 'rgba(0,0,8,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return tex(c);
}

export function makeSpeedlines() {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, len = 40 + Math.random() * 120, w = 1 + Math.random() * 2;
    const y = Math.random() * 256;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(.5, `rgba(255,255,255,${0.25 + Math.random() * 0.5})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, len);
  }
  const t = tex(c, true);
  return t;
}
