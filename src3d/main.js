// Автодром 3D — Кызылорда. Three.js + Capacitor/Vite. r186.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('game3d');
const $ = (id) => document.getElementById(id);
const TOTAL_LAPS = 3;
const STEP = 1 / 60;
const MAX_SPEED = 33;          // m/s = 118 km/h
const ACC = 10, BRK = 14;
const fmt = (t) => { const m = Math.floor(t / 60), s = (t % 60).toFixed(2); return `${m}:${s.padStart(5, '0')}` };

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d6);
scene.fog = new THREE.Fog(0x87b5d6, 260, 900);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xc2b280, 1.15));
const sun = new THREE.DirectionalLight(0xfff2d0, 2.2);
sun.position.set(120, 180, 60); scene.add(sun);

// ---------- Kyzylorda stylised map ----------
const world = new THREE.Group(); scene.add(world);
function mat(c, rough = 0.95) { return new THREE.MeshStandardMaterial({ color: c, roughness: rough }); }

// ground: steppe
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1600), mat(0xc9b176));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; world.add(ground);
// city base (right bank) — faint green grid block
const cityBase = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), mat(0x9db873));
cityBase.rotation.x = -Math.PI / 2; cityBase.position.set(-260, 0, 0); world.add(cityBase);
// Syr Darya — wide turquoise ribbon SW-NE
const river = new THREE.Mesh(new THREE.PlaneGeometry(2100, 150), new THREE.MeshStandardMaterial({ color: 0x2e8fb5, roughness: 0.4 }));
river.rotation.x = -Math.PI / 2; river.rotation.z = 0.45; river.position.set(-60, 0.01, 340); world.add(river);

function road(x1, z1, x2, z2, w = 16) {
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat(0x3a3f47));
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(dx, dz);
  m.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
  world.add(m);
  // centre dashes
  const n = Math.max(1, Math.floor(len / 14));
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5), dashMat);
    d.rotation.x = -Math.PI / 2; d.rotation.z = Math.atan2(dx, dz);
    d.position.set(x1 + dx * t, 0.05, z1 + dz * t);
    world.add(d);
  }
  return { x1, z1, x2, z2, w };
}
// Central avenues (stylised): Abai E-W, Nazarbayev N-S, Abylay Khan, Kunaev, Tausyzdik riverside
const streets = [
  road(-650, -80, 250, -80, 18),   // Abai
  road(-180, -350, -180, 220, 16), // Nazarbayev
  road(-380, -350, -380, 220, 14), // Abylay Khan
  road(40, -320, 40, 180, 14),     // Kunaev
  road(-650, 180, 250, 180, 22),   // Tausyzdik riverside
  road(-180, 180, -180, 520, 16),  // Muratbaev bridge road
  road(-180, 180, -180, 250, 16),
  road(-650, -300, 250, -300, 14),
  road(180, -350, 180, 220, 14),
];

// bridges over the river (deck boxes)
for (const bx of [-180, 40]) {
  const deck = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 220), mat(0x555b63));
  deck.position.set(bx, 1.2, 340); world.add(deck);
}
// park (green) + stadium
const park = new THREE.Mesh(new THREE.PlaneGeometry(150, 110), mat(0x3f8f3f));
park.rotation.x = -Math.PI / 2; park.position.set(90, 0.03, -190); world.add(park);
const stadium = new THREE.Mesh(new THREE.BoxGeometry(70, 14, 48), mat(0xd8d8d8));
stadium.position.set(90, 7, -190); world.add(stadium);
// buildings: InstancedMesh boxes on right-bank blocks
const bGeo = new THREE.BoxGeometry(1, 1, 1);
const bMat = mat(0xcfd4d9);
const citySlots = [];
for (let gx = -620; gx <= 220; gx += 44) for (let gz = -330; gz <= 160; gz += 44) {
  if (Math.abs(gx + 180) < 26 || Math.abs(gz + 80) < 26 || Math.abs(gx - 40) < 24 || Math.abs(gx + 380) < 22 || Math.abs(gx - 180) < 24 || gz > 150) continue;
  if (gx > 30 && gx < 170 && gz > -250 && gz < -130) continue; // park/stadium clear
  if (Math.random() < 0.32) continue;
  citySlots.push([gx, gz]);
}
const bMesh = new THREE.InstancedMesh(bGeo, bMat, citySlots.length);
{
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  citySlots.forEach(([x, z], i) => {
    const h = 8 + Math.random() * 26;
    p.set(x, h / 2, z); s.set(16 + Math.random() * 10, h, 16 + Math.random() * 10);
    e.set(0, 0, 0); q.setFromEuler(e);
    m4.compose(p, q, s); bMesh.setMatrixAt(i, m4);
  });
}
world.add(bMesh);
// trees: cones on park + avenues (instanced)
const tGeo = new THREE.ConeGeometry(3, 9, 6);
const tMesh = new THREE.InstancedMesh(tGeo, mat(0x2e6b2e), 70);
{
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 70; i++) {
    const inPark = i < 40;
    const x = inPark ? 20 + Math.random() * 140 : -650 + Math.random() * 900;
    const z = inPark ? -240 + Math.random() * 100 : (Math.random() < 0.5 ? -70 + Math.random() * 20 : 190 + Math.random() * 20);
    m4.makeTranslation(x, 4.5, z); tMesh.setMatrixAt(i, m4);
  }
}
world.add(tMesh);

// name signs (sprites, canvas text) RU+KZ
try {
  const sign = (text, x, z) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d'); g.fillStyle = '#10151f'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#ffc933'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.fillText(text, 256, 62);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    sp.scale.set(26, 5, 1); sp.position.set(x, 10, z); world.add(sp);
  };
  sign('Абай', -400, -68); sign('Назарбаев', -200, -200); sign('Абылай хан', -400, -200);
  sign('Кунаев', 60, -200); sign('Тәуелсіздік', -300, 196); sign('Сырдарья', 300, 420);
} catch {}

// ---------- Autodrom ring (oval + chicane), steppe east of city ----------
const ringPts = [
  new THREE.Vector3(520, 0, -40), new THREE.Vector3(760, 0, -60), new THREE.Vector3(900, 0, -200),
  new THREE.Vector3(860, 0, -360), new THREE.Vector3(620, 0, -430), new THREE.Vector3(480, 0, -330),
  new THREE.Vector3(430, 0, -220), new THREE.Vector3(500, 0, -150),
];
const ringCurve = new THREE.CatmullRomCurve3(ringPts, true, 'catmullrom', 0.35);
const ringPtsDense = ringCurve.getSpacedPoints(360);
function nearestOnRing(x, z) {
  let best = { d: 1e9, i: 0 };
  for (let i = 0; i < ringPtsDense.length; i++) {
    const d = Math.hypot(ringPtsDense[i].x - x, ringPtsDense[i].z - z);
    if (d < best.d) best = { d, i };
  }
  return best;
}
// road ribbon from spline
{
  const W = 9, N = ringPtsDense.length;
  const verts = new Float32Array(N * 2 * 3), idx = [];
  for (let i = 0; i < N; i++) {
    const p = ringPtsDense[i], q = ringPtsDense[(i + 1) % N] ?? ringPtsDense[0];
    const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    verts[i * 6 + 0] = p.x - nx * W; verts[i * 6 + 1] = 0.06; verts[i * 6 + 2] = p.z - nz * W;
    verts[i * 6 + 3] = p.x + nx * W; verts[i * 6 + 4] = 0.06; verts[i * 6 + 5] = p.z + nz * W;
    const a = i * 2, b = (i + 1) % N * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3)); g.setIndex(idx);
  world.add(new THREE.Mesh(g, mat(0x3a3f47)));
}
// kerbs: red/white posts every 15m
{
  const kGeo = new THREE.BoxGeometry(1.4, 0.5, 1.4);
  const red = new THREE.InstancedMesh(kGeo, mat(0xd23b3b), 48);
  const whi = new THREE.InstancedMesh(kGeo, mat(0xffffff), 48);
  const m4 = new THREE.Matrix4(); let ri = 0, wi = 0;
  for (let i = 0; i < 96; i++) {
    const p = ringPtsDense[Math.floor(i * ringPtsDense.length / 96)];
    const q = ringPtsDense[(Math.floor(i * ringPtsDense.length / 96) + 1) % ringPtsDense.length];
    const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    const px = p.x + nx * 10, pz = p.z + nz * 10;
    m4.makeTranslation(px, 0.25, pz);
    if (i % 2 === 0) red.setMatrixAt(ri++, m4); else whi.setMatrixAt(wi++, m4);
  }
  world.add(red, whi);
}
// start gantry
{
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(24, 2.5, 2), mat(0x151a24));
  top.position.y = 9; g.add(top);
  for (const sx of [-11, 11]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 2), mat(0x222a38));
    leg.position.set(sx, 4.5, 0); g.add(leg);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(22, 2), new THREE.MeshBasicMaterial({ color: 0xffc933 }));
  banner.position.set(0, 9, 1.05); g.add(banner);
  g.position.set(520, 0, -40); g.rotation.y = 0.9; world.add(g);
}

// ---------- Car (GLB, CC0 Spectral main; Ferrari fallback; primitive last) ----------
const car = { x: 500, z: -120, heading: 0.9, vx: 0, vz: 0, speed: 0, mesh: null, wheels: [] };
const loader = new GLTFLoader();
function primitiveCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.6), mat(0xe03131));
  body.position.y = 0.6; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 2.2), mat(0x202635));
  cab.position.set(0, 1.15, -0.2); g.add(cab);
  const wGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12), wMat = mat(0x111111);
  for (const [x, z] of [[-1.15, 1.5], [1.15, 1.5], [-1.15, -1.5], [1.15, -1.5]]) {
    const w = new THREE.Mesh(wGeo, wMat); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); car.wheels.push(w);
  }
  g.scale.setScalar(1.1);
  return g;
}
function attachCar(root) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
  root.rotation.y = Math.PI / 2; // Spectral front +X -> -Z
  car.mesh = new THREE.Group(); car.mesh.add(root);
  car.mesh.position.set(car.x, 0, car.z); scene.add(car.mesh);
}
loader.loadAsync('models/spectral_gt_rs.glb').then((g) => attachCar(g.scene)).catch(() =>
  loader.loadAsync('models/ferrari.glb').then((g) => attachCar(g.scene)).catch(() => attachCar(primitiveCar())));
car.mesh = primitiveCar(); car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = Math.PI / 2; scene.add(car.mesh);

// ---------- Game state ----------
let mode = 'menu'; // menu | prep | ready | race | pause | finish
let lap = 1, raceT = 0, penTime = 0, last = performance.now(), acc = 0;
let sector = 0, speedZoneT = 0, offTrackT = 0, camMode = 'chase';
const penalties = [];
function addPenalty(sec, label) { penTime += sec; penalties.push({ sec, label, t: raceT }); const el = $('toast'); el.textContent = `⚠ ${label} +${sec}с`; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 2200); $('pen').textContent = penTime.toFixed(0); }
function pressInput(btn, key) {
  const el = $(btn);
  const on = (e) => { e.preventDefault(); input[key] = 1; el.setPointerCapture?.(e.pointerId) };
  const off = (e) => { e.preventDefault(); input[key] = 0 };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
const input = { steer: 0, gas: 0, brake: 0, hand: 0 };
pressInput('btnGas', 'gas'); pressInput('btnBrake', 'brake'); pressInput('btnHand', 'hand');
pressInput('btnLeft', 'steer', ); $( 'btnLeft').addEventListener('pointerdown', () => input.steer = -1); $('btnLeft').addEventListener('pointerup', () => input.steer = 0);
$('btnRight').addEventListener('pointerdown', () => input.steer = 1); $('btnRight').addEventListener('pointerup', () => input.steer = 0);
let dragSteer = false, dragX0 = 0;
canvas.addEventListener('pointerdown', (e) => { if (e.clientX < window.innerWidth * 0.45 && !e.target.classList?.contains('btn')) { dragSteer = true; dragX0 = e.clientX } });
canvas.addEventListener('pointermove', (e) => { if (dragSteer) input.steer = Math.max(-1, Math.min(1, (e.clientX - dragX0) / 90)) });
canvas.addEventListener('pointerup', () => { dragSteer = false; if (input.steer && !keys.left && !keys.right) input.steer = 0 });
const keys = { left: false, right: false };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') { keys.left = true; input.steer = -1 }
  if (k === 'arrowright' || k === 'd') { keys.right = true; input.steer = 1 }
  if (k === 'arrowup' || k === 'w') input.gas = 1;
  if (k === 'arrowdown' || k === 's') input.brake = 1;
  if (e.code === 'Space') { input.hand = 1; e.preventDefault() }
  if (k === 'c' || k === 'с') toggleCam();
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if ((k === 'arrowleft' || k === 'a') && !keys.right) { keys.left = false; input.steer = 0 }
  if ((k === 'arrowright' || k === 'd') && !keys.left) { keys.right = false; input.steer = 0 }
  if (k === 'arrowup' || k === 'w') input.gas = 0;
  if (k === 'arrowdown' || k === 's') input.brake = 0;
  if (e.code === 'Space') input.hand = 0;
});
function toggleCam() { camMode = camMode === 'chase' ? 'top' : 'chase' }
$('btnCam').onclick = toggleCam;
$('btnPause').onclick = () => { if (mode === 'race') mode = 'pause'; else if (mode === 'pause') mode = 'race' };
$('btnReset').onclick = () => resetCar();
$('btnToPrep').onclick = () => { mode = 'prep'; $('menu').classList.add('hidden'); $('prep').classList.remove('hidden') };
$('btnBack').onclick = () => { mode = 'menu'; $('prep').classList.add('hidden'); $('menu').classList.remove('hidden') };
$('btnSkip').onclick = () => {
  const boxes = document.querySelectorAll('#prep input[type=checkbox]');
  let skipped = 0; boxes.forEach((b) => { if (!b.checked) skipped++ });
  const p = Math.min(20, skipped * 5);
  penTime += p; penalties.push({ sec: p, label: 'подготовка', t: 0 });
  $('prepPen').textContent = skipped ? `Быстрый старт: пропущено ${skipped}, штраф +${p}с` : 'Полная подготовка: штрафа нет';
  startRace();
};
$('btnStart').onclick = () => {
  const boxes = document.querySelectorAll('#prep input[type=checkbox]');
  let skipped = 0; boxes.forEach((b) => { if (!b.checked) skipped++ });
  const p = Math.min(20, skipped * 5);
  if (p > 0) { penTime += p; penalties.push({ sec: p, label: 'подготовка', t: 0 }) }
  $('prepPen').textContent = skipped ? `Штраф за подготовку: +${p}с (${skipped} пропуск)` : 'Подготовка полная: +0с';
  startRace();
};
function startRace() {
  resetCar(true); lap = 1; raceT = 0; sector = 0; speedZoneT = 0; offTrackT = 0;
  mode = 'ready';
  $('prep').classList.add('hidden'); $('finish').classList.add('hidden');
  $('pen').textContent = penTime.toFixed(0);
  setTimeout(() => { if (mode === 'ready') mode = 'race' }, 300);
}
function resetCar(silent) {
  car.x = 500; car.z = -120; car.heading = 0.9; car.vx = 0; car.vz = 0; car.speed = 0; sector = 0;
}
$('btnRestart').onclick = () => { penTime = 0; penalties.length = 0; $('pen').textContent = '0'; startRace() };
$('btnToMenu').onclick = () => { mode = 'menu'; $('finish').classList.add('hidden'); $('menu').classList.remove('hidden') };

function finishRace() {
  mode = 'finish';
  const total = raceT + penTime;
  const lines = penalties.map((p) => `• ${p.label} +${p.sec}с`).join('<br/>') || '—';
  $('finishTxt').innerHTML = `Чистое время: <b>${fmt(raceT)}</b><br/>Штрафы: <b>+${penTime.toFixed(0)}с</b><br/>Итого: <b>${fmt(total)}</b><br/><br/>${lines}`;
  $('finish').classList.remove('hidden');
}

// ---------- Physics (fixed 1/60, accumulator) ----------
function physics(dt) {
  const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading); // forward -Z convention
  let fwd = car.vx * fx + car.vz * fz;
  if (input.gas) fwd += ACC * dt;
  if (input.brake) { if (fwd > 1) fwd -= BRK * dt; else fwd -= 8 * dt }
  const np = nearestOnRing(car.x, car.z);
  const off = np.d > 13; // half-width 9 + margin
  fwd *= Math.exp(-(input.hand ? 0.5 : 0.16) * dt);
  if (off) fwd *= Math.exp(-1.6 * dt);
  fwd = Math.max(-10, Math.min(fwd, MAX_SPEED * (off ? 0.6 : 1)));
  let lx = car.vx - fx * fwd, lz = car.vz - fz * fwd;
  const grip = input.hand ? 3.0 : 9.0, k = Math.exp(-grip * dt);
  lx *= k; lz *= k;
  const steerMax = 1.9 * (1 / (1 + Math.abs(fwd) * 0.02));
  car.heading += input.steer * steerMax * dt * Math.sign(fwd || 1) * Math.min(1, Math.abs(fwd) / 5 + 0.4);
  car.vx = fx * fwd + lx; car.vz = fz * fwd + lz;
  car.x += car.vx * dt; car.z += car.vz * dt;
  car.speed = fwd;
  // wheels spin + steer visual
  if (car.mesh) for (const w of car.wheels) w.rotation.x += fwd * dt / 0.42;
  return { np, off };
}

// ---------- Update (render loop) ----------
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  let dt = Math.min(Math.max(timer.getDelta(), 0), 0.1);
  if (mode === 'race' || mode === 'ready') {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP; raceT += STEP;
      const { np, off } = physics(STEP);
      // lap: crossing start band (index progress)
      const prog = np.i / ringPtsDense.length;
      if (prog < 0.08 && sector > 0.7 && np.d < 16) {
        // crossed start/finish
        if (lap >= TOTAL_LAPS) { finishRace(); break }
        lap++; sector = 0; addPenalty(0, 'круг ' + (lap - 1) + ' засчитан');
        $('toast').style.display = 'none';
      } else sector = prog;
      // speed zone: city speed limit 40 km/h -> penalty if > 3s over
      const kmh = Math.abs(car.speed * 3.6);
      const inCity = car.x < 300 && car.z > -380 && car.z < 240;
      if (inCity && kmh > 40) { speedZoneT += STEP; if (speedZoneT > 3) { addPenalty(10, 'превышение 40'); speedZoneT = 0 } }
      else speedZoneT = Math.max(0, speedZoneT - STEP);
      // off-track
      if (off) { offTrackT += STEP; if (offTrackT > 10) { addPenalty(5, 'выезд за трассу'); offTrackT = 0 } }
      else offTrackT = Math.max(0, offTrackT - STEP);
      if (mode === 'finish') break;
    }
    // mesh follow
    if (car.mesh) { car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = car.heading + Math.PI / 2 }
    // camera: exponential smoothing + look-ahead (camera-systems)
    const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
    let tx, ty, tz;
    if (camMode === 'chase') { tx = car.x - fx * 11 + car.vx * 0.25; ty = 5.2; tz = car.z - fz * 11 + car.vz * 0.25 }
    else { tx = car.x; ty = 38; tz = car.z + 18 }
    const t = 1 - Math.exp(-5 * dt);
    camera.position.x += (tx - camera.position.x) * t; camera.position.y += (ty - camera.position.y) * t; camera.position.z += (tz - camera.position.z) * t;
    if (camMode === 'chase') camera.lookAt(car.x + car.vx * 0.5, 1.2, car.z + car.vz * 0.5);
    else camera.lookAt(car.x, 0, car.z);
    $('spd').textContent = String(Math.abs(Math.round(car.speed * 3.6)));
    $('lap').textContent = `${Math.min(lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
    $('time').textContent = fmt(raceT);
  } else if (mode === 'menu' || mode === 'prep') {
    // orbit preview around car while in menu
    const t = performance.now() / 1000;
    camera.position.set(car.x + Math.sin(t * 0.3) * 16, 6, car.z + Math.cos(t * 0.3) * 16);
    camera.lookAt(car.x, 1, car.z);
    if (car.mesh) { car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = car.heading + Math.PI / 2 }
  }
  renderer.render(scene, camera);
});
