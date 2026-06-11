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
};

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

  // train side: white body (instance-tintable), dark window band, doors, skirt
  {
    const r = REG.trainSide;
    g.fillStyle = '#f4f4f6'; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#e2e2e6'; g.fillRect(r.x, r.y, r.w, 18);                  // roof line
    g.fillStyle = '#33343c'; g.fillRect(r.x, r.y + r.h - 34, r.w, 34);      // skirt
    g.fillStyle = '#caccd4'; g.fillRect(r.x, r.y + r.h - 40, r.w, 6);
    // window band
    g.fillStyle = '#10141f';
    g.fillRect(r.x + 10, r.y + 52, r.w - 20, 64);
    for (let i = 0; i < 6; i++) {
      const wx = r.x + 22 + i * 82;
      g.fillStyle = '#2c3c58';
      g.fillRect(wx, r.y + 58, 62, 52);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(wx + 6, r.y + 58, 12, 52);
      g.fillStyle = '#10141f';
    }
    // doors
    for (const dx of [120, 330]) {
      g.fillStyle = '#9aa0ac';
      g.fillRect(r.x + dx, r.y + 46, 56, r.h - 84);
      g.fillStyle = '#2c3c58'; g.fillRect(r.x + dx + 6, r.y + 56, 18, 46);
      g.fillRect(r.x + dx + 32, r.y + 56, 18, 46);
      g.strokeStyle = '#5c606c'; g.lineWidth = 3;
      g.strokeRect(r.x + dx, r.y + 46, 56, r.h - 84);
      g.beginPath(); g.moveTo(r.x + dx + 28, r.y + 46); g.lineTo(r.x + dx + 28, r.y + r.h - 38); g.stroke();
    }
    // accent stripe under windows (mid gray → darker shade of tint)
    g.fillStyle = '#9a9aa2'; g.fillRect(r.x, r.y + 126, r.w, 16);
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
export function makeWindows() {
  const [c, g] = canvas(256, 256);
  const [ce, ge] = canvas(256, 256);
  // wall: near-white (vertex tint gives the color)
  g.fillStyle = '#f2f1ee'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 200; i++) {
    g.fillStyle = `rgba(0,0,20,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 256);
  const COLS = 4, ROWS = 4, cw = 256 / COLS, ch = 256 / ROWS;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const wx = x * cw + 10, wy = y * ch + 12, ww = cw - 20, wh = ch - 24;
      g.fillStyle = '#39414f';
      g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const grad = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      grad.addColorStop(0, '#2b3950'); grad.addColorStop(.5, '#46607f'); grad.addColorStop(1, '#222d40');
      g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.moveTo(wx + ww * .15, wy + wh); g.lineTo(wx + ww * .35, wy); g.lineTo(wx + ww * .5, wy); g.lineTo(wx + ww * .3, wy + wh); g.fill();
      // emissive: ~half of the windows lit warm at night
      if (Math.random() < 0.52) {
        const warm = ['#ffd98a', '#ffc46b', '#fff2c4', '#ffb55e'][(Math.random() * 4) | 0];
        ge.fillStyle = warm; ge.fillRect(wx, wy, ww, wh);
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
