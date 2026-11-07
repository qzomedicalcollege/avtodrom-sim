// Автодром 3D — Кызылорда. Three.js r186 + Vite/Capacitor.
// Фикс v2: старт строго на трассе, env-свет, руль+педали+рычаг+КПП, город по сетке.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('game3d');
const $ = (id) => document.getElementById(id);
const TOTAL_LAPS = 3;
const STEP = 1 / 60;
const TOP = 33;
const GEARS = {
  R: { max: 8, acc: 4 }, N: { max: 0, acc: 0 },
  1: { max: 14, acc: 10 }, 2: { max: 22, acc: 8 }, 3: { max: 29, acc: 7 },
  4: { max: 36, acc: 6 }, 5: { max: 42, acc: 5 },
};
const fmt = (t) => { const m = Math.floor(t / 60), s = (t % 60).toFixed(2); return `${m}:${s.padStart(5, '0')}` };

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d6);
scene.fog = new THREE.Fog(0x87b5d6, 260, 980);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize); resize();
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xc2b280, 0.7));
const sun = new THREE.DirectionalLight(0xfff2d0, 1.6);
sun.position.set(120, 180, 60); scene.add(sun);

const world = new THREE.Group(); scene.add(world);
function mat(c, rough = 0.95) { return new THREE.MeshStandardMaterial({ color: c, roughness: rough }); }

// ground: steppe + city asphalt pad + autodrom pad
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1600), mat(0xc9b176));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; world.add(ground);
const cityBase = new THREE.Mesh(new THREE.PlaneGeometry(920, 660), mat(0x8f9a80));
cityBase.rotation.x = -Math.PI / 2; cityBase.position.set(-260, 0, -40); world.add(cityBase);
const pad = new THREE.Mesh(new THREE.PlaneGeometry(620, 520), mat(0x555b63));
pad.rotation.x = -Math.PI / 2; pad.position.set(600, 0.01, -230); world.add(pad);
// Syr Darya ribbon
const river = new THREE.Mesh(new THREE.PlaneGeometry(2100, 150), new THREE.MeshStandardMaterial({ color: 0x2e8fb5, roughness: 0.35 }));
river.rotation.x = -Math.PI / 2; river.rotation.z = 0.45; river.position.set(-60, 0.01, 340); world.add(river);

function road(x1, z1, x2, z2, w = 16) {
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat(0x3a3f47));
  m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(dx, dz);
  m.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
  world.add(m);
  const n = Math.max(1, Math.floor(len / 14));
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5), dashMat);
    d.rotation.x = -Math.PI / 2; d.rotation.z = Math.atan2(dx, dz);
    d.position.set(x1 + dx * t, 0.05, z1 + dz * t);
    world.add(d);
  }
}
road(-650, -80, 250, -80, 18);   // Abai
road(-180, -350, -180, 220, 16); // Nazarbayev
road(-380, -350, -380, 220, 14); // Abylay Khan
road(40, -320, 40, 180, 14);     // Kunaev
road(-650, 180, 250, 180, 22);   // Tausyzdik riverside
road(-180, 180, -180, 520, 16);  // Muratbaev bridge road
road(-650, -300, 250, -300, 14);
road(180, -350, 180, 220, 14);
for (const bx of [-180, 40]) {
  const deck = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 220), mat(0x555b63));
  deck.position.set(bx, 1.2, 340); world.add(deck);
}
const park = new THREE.Mesh(new THREE.PlaneGeometry(150, 110), mat(0x3f8f3f));
park.rotation.x = -Math.PI / 2; park.position.set(90, 0.03, -190); world.add(park);
const stadium = new THREE.Mesh(new THREE.BoxGeometry(70, 14, 48), mat(0xd8d8d8));
stadium.position.set(90, 7, -190); world.add(stadium);
// buildings: rows facing streets (deterministic grid, not sand scatter)
const bGeo = new THREE.BoxGeometry(1, 1, 1);
const slots = [];
for (let gx = -620; gx <= 220; gx += 56) for (let gz = -330; gz <= 160; gz += 56) {
  if (Math.abs(gx + 180) < 30 || Math.abs(gz + 80) < 30 || Math.abs(gx - 40) < 27 || Math.abs(gx + 380) < 25 || Math.abs(gx - 180) < 27) continue;
  if (Math.abs(gz + 300) < 20) continue;
  if (gx > 30 && gx < 190 && gz > -260 && gz < -120) continue; // park/stadium
  if (((gx + gz) * 37) % 11 < 3) continue; // pseudo-random holes
  slots.push([gx, gz]);
}
const bMesh = new THREE.InstancedMesh(bGeo, mat(0xcfd4d9), slots.length);
{
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  slots.forEach(([x, z], i) => {
    const h = 9 + (((x * 13 + z * 7) % 23 + 23) % 23) * 1.1;
    p.set(x, h / 2, z); s.set(20, h, 20); e.set(0, 0, 0); q.setFromEuler(e);
    m4.compose(p, q, s); bMesh.setMatrixAt(i, m4);
  });
}
world.add(bMesh);
// trees along park + avenues
const tGeo = new THREE.ConeGeometry(3, 9, 6);
const tMesh = new THREE.InstancedMesh(tGeo, mat(0x2e6b2e), 56);
{
  const m4 = new THREE.Matrix4(); let ti = 0;
  for (let i = 0; i < 40; i++) { m4.makeTranslation(25 + (i * 37) % 130, 4.5, -235 + (i * 53) % 90); tMesh.setMatrixAt(ti++, m4) }
  for (let i = 0; i < 16; i++) { m4.makeTranslation(-640 + i * 55, 4.5, i % 2 ? -68 : 192); tMesh.setMatrixAt(ti++, m4) }
}
world.add(tMesh);
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

// ---------- Autodrom ring ----------
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
function ribbon(width, y, color) {
  const N = ringPtsDense.length, verts = new Float32Array(N * 2 * 3), idx = [];
  for (let i = 0; i < N; i++) {
    const p = ringPtsDense[i], q = ringPtsDense[(i + 1) % N];
    const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    verts[i * 6 + 0] = p.x - nx * width; verts[i * 6 + 1] = y; verts[i * 6 + 2] = p.z - nz * width;
    verts[i * 6 + 3] = p.x + nx * width; verts[i * 6 + 4] = y; verts[i * 6 + 5] = p.z + nz * width;
    const a = i * 2, b = (i + 1) % N * 2; idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3)); g.setIndex(idx);
  return new THREE.Mesh(g, mat(color));
}
world.add(ribbon(9, 0.06, 0x3a3f47));                 // asphalt
world.add(ribbon(9.6, 0.055, 0xffffff));              // white edge underlay (peeks at edges)
// start line + direction arrows
{
  const p0 = ringCurve.getPointAt(0), t0 = ringCurve.getTangentAt(0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(t0.x, t0.z);
  line.position.set(p0.x, 0.09, p0.z); world.add(line);
  for (let k = 1; k <= 3; k++) {
    const p = ringCurve.getPointAt(k * 0.08), t = ringCurve.getTangentAt(k * 0.08);
    const a = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5, 3), new THREE.MeshBasicMaterial({ color: 0xffc933 }));
    a.rotation.x = -Math.PI / 2; a.rotation.z = Math.atan2(t.x, t.z) + Math.PI;
    a.position.set(p.x, 0.1, p.z); world.add(a);
  }
}
// gantry aligned to start tangent
{
  const p0 = ringCurve.getPointAt(0), t0 = ringCurve.getTangentAt(0);
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(24, 2.5, 2), mat(0x151a24));
  top.position.y = 9; g.add(top);
  for (const sx of [-11, 11]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 2), mat(0x222a38));
    leg.position.set(sx, 4.5, 0); g.add(leg);
  }
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(22, 2), new THREE.MeshBasicMaterial({ color: 0xffc933 }));
  banner.position.set(0, 9, 1.05); g.add(banner);
  g.position.set(p0.x, 0, p0.z); g.rotation.y = Math.atan2(t0.x, t0.z) + Math.PI / 2; world.add(g);
}

// ---------- Car ----------
const car = { x: 0, z: 0, heading: 0, vx: 0, vz: 0, speed: 0, mesh: null, wheels: [], prim: false };
function startPose() {
  const p0 = ringCurve.getPointAt(0), t0 = ringCurve.getTangentAt(0).normalize();
  car.x = p0.x; car.z = p0.z;
  car.heading = Math.atan2(-t0.x, -t0.z); // forward (-sin h, -cos h) = tangent
  car.vx = 0; car.vz = 0; car.speed = 0;
}
startPose();
function primitiveCar() {
  car.prim = true;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.6), mat(0xe03131));
  body.position.y = 0.6; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 2.2), mat(0x202635));
  cab.position.set(0, 1.15, -0.2); g.add(cab);
  const wGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12), wMat = mat(0x111111);
  car.wheels = [];
  for (const [x, z] of [[-1.15, 1.5], [1.15, 1.5], [-1.15, -1.5], [1.15, -1.5]]) {
    const w = new THREE.Mesh(wGeo, wMat); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); car.wheels.push(w);
  }
  return g;
}
function attachCar(root, isPrim) {
  if (!isPrim) {
    // Spectral front is +X: rotate so front faces -Z (physics forward at heading 0)
    root.rotation.y = Math.PI / 2;
    // find wheels by name for spin fallback (best-effort, axis unknown -> skip spin if unsure)
    car.wheels = [];
    root.traverse((o) => { if (o.isMesh && /wheel/i.test(o.name || '')) car.wheels.push(o) });
  }
  car.mesh = new THREE.Group(); car.mesh.add(root);
  car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = car.heading + Math.PI / 2;
  scene.add(car.mesh);
}
const loader = new GLTFLoader();
car.mesh = primitiveCar(); car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = car.heading + Math.PI / 2; scene.add(car.mesh);
loader.loadAsync('models/spectral_gt_rs.glb').then((g) => { scene.remove(car.mesh); attachCar(g.scene, false) })
  .catch(() => loader.loadAsync('models/ferrari.glb').then((g) => { scene.remove(car.mesh); attachCar(g.scene, false) }).catch(() => {}));

// ---------- Game state ----------
let mode = 'menu';
let lap = 1, raceT = 0, penTime = 0, acc = 0;
let sector = 0, speedZoneT = 0, offTrackT = 0, camMode = 'chase', gear = 'N';
const penalties = [];
function addPenalty(sec, label) {
  penTime += sec; penalties.push({ sec, label, t: raceT });
  const el = $('toast'); el.textContent = `⚠ ${label} +${sec}с`; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 2200);
  $('pen').textContent = penTime.toFixed(0);
}
const input = { steer: 0, gas: 0, brake: 0, hand: 0 };
const keys = { left: false, right: false };

// steering wheel: drag to rotate
{
  const wheel = $('wheel');
  let dragging = false;
  const set = (e) => {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const ang = Math.atan2(dx, -dy); // 0 = up
    input.steer = Math.max(-1, Math.min(1, ang / (Math.PI * 0.65)));
    wheel.style.transform = `rotate(${input.steer * 110}deg)`;
  };
  wheel.addEventListener('pointerdown', (e) => { dragging = true; wheel.setPointerCapture(e.pointerId); set(e); e.preventDefault() });
  wheel.addEventListener('pointermove', (e) => { if (dragging) set(e) });
  const end = () => { dragging = false; if (!keys.left && !keys.right) { input.steer = 0; wheel.style.transform = 'rotate(0deg)' } };
  wheel.addEventListener('pointerup', end); wheel.addEventListener('pointercancel', end);
}
// pedals
function pedal(id, key) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); input[key] = 1; el.setPointerCapture?.(e.pointerId) };
  const off = (e) => { e.preventDefault(); input[key] = 0 };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
pedal('pedalGas', 'gas'); pedal('pedalBrake', 'brake');
// handbrake lever
{
  const lev = $('lever');
  const on = (e) => { e.preventDefault(); input.hand = 1; lev.classList.add('on'); lev.style.top = '6%'; lev.setPointerCapture(e.pointerId) };
  const off = (e) => { e.preventDefault(); input.hand = 0; lev.classList.remove('on'); lev.style.top = '64%' };
  lev.addEventListener('pointerdown', on); lev.addEventListener('pointerup', off); lev.addEventListener('pointercancel', off); lev.addEventListener('pointerleave', off);
}
// gear gate
const knobPos = { R: [4, 2], 1: [42, 2], 3: [80, 2], N: [42, 40], 2: [4, 78], 4: [42, 78], 5: [80, 78] };
function setGear(g) {
  if (!GEARS[g]) return;
  gear = g;
  document.querySelectorAll('#gearGate .slot').forEach((s) => s.classList.toggle('on', s.dataset.g === g));
  const [x, y] = knobPos[g]; const knob = $('gearKnob');
  knob.style.left = x + 'px'; knob.style.top = y + 'px';
  $('gear').textContent = g;
}
document.querySelectorAll('#gearGate .slot').forEach((s) => s.addEventListener('pointerdown', (e) => { e.preventDefault(); setGear(s.dataset.g) }));
setGear('N');
// keyboard
function toggleCam() { camMode = camMode === 'chase' ? 'top' : 'chase' }
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') { keys.left = true; input.steer = -1 }
  if (k === 'arrowright' || k === 'd') { keys.right = true; input.steer = 1 }
  if (k === 'arrowup' || k === 'w') input.gas = 1;
  if (k === 'arrowdown' || k === 's') input.brake = 1;
  if (e.code === 'Space') { input.hand = 1; e.preventDefault() }
  if (k === 'c' || k === 'с') toggleCam();
  if (['1', '2', '3', '4', '5'].includes(k)) setGear(k);
  if (k === 'r' || k === 'к') setGear('R');
  if (k === 'n' || k === 'т') setGear('N');
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if ((k === 'arrowleft' || k === 'a') && !keys.right) { keys.left = false; input.steer = 0; $('wheel').style.transform = 'rotate(0deg)' }
  if ((k === 'arrowright' || k === 'd') && !keys.left) { keys.right = false; input.steer = 0; $('wheel').style.transform = 'rotate(0deg)' }
  if (k === 'arrowup' || k === 'w') input.gas = 0;
  if (k === 'arrowdown' || k === 's') input.brake = 0;
  if (e.code === 'Space') input.hand = 0;
});
// buttons
$('btnCam').onclick = toggleCam;
$('btnPause').onclick = () => { if (mode === 'race') mode = 'pause'; else if (mode === 'pause') mode = 'race' };
$('btnReset').onclick = () => { startPose() };
$('btnToPrep').onclick = () => { mode = 'prep'; $('menu').classList.add('hidden'); $('prep').classList.remove('hidden') };
$('btnBack').onclick = () => { mode = 'menu'; $('prep').classList.add('hidden'); $('menu').classList.remove('hidden') };
function prepPenalty() {
  const boxes = document.querySelectorAll('#prep input[type=checkbox]');
  let skipped = 0; boxes.forEach((b) => { if (!b.checked) skipped++ });
  const p = Math.min(20, skipped * 5);
  if (p > 0) { penTime += p; penalties.push({ sec: p, label: 'подготовка', t: 0 }) }
  $('prepPen').textContent = skipped ? `Штраф за подготовку: +${p}с (${skipped} пропуск)` : 'Подготовка полная: +0с';
  return p;
}
$('btnSkip').onclick = () => { prepPenalty(); startRace() };
$('btnStart').onclick = () => { prepPenalty(); startRace() };
function startRace() {
  startPose(); lap = 1; raceT = 0; sector = 0; speedZoneT = 0; offTrackT = 0; setGear('N');
  mode = 'ready';
  $('prep').classList.add('hidden'); $('finish').classList.add('hidden');
  $('pen').textContent = penTime.toFixed(0);
  setTimeout(() => { if (mode === 'ready') mode = 'race' }, 300);
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

// ---------- Physics (fixed 1/60) ----------
function physics(dt) {
  const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
  let fwd = car.vx * fx + car.vz * fz;
  const g = GEARS[gear];
  if (gear === 'R') { if (input.gas) fwd -= g.acc * dt; if (input.brake && fwd < 0) fwd += 6 * dt; }
  else if (gear !== 'N') { if (input.gas) fwd += g.acc * dt; if (input.brake && fwd > 0) fwd -= 14 * dt; }
  const np = nearestOnRing(car.x, car.z);
  const off = np.d > 14;
  fwd *= Math.exp(-(input.hand ? 0.5 : 0.16) * dt);
  if (off) fwd *= Math.exp(-1.6 * dt);
  const cap = gear === 'R' ? -g.max : g.max;
  fwd = Math.max(Math.min(cap, 0) - 2, Math.min(fwd, cap <= 0 ? 0 : cap * (off ? 0.6 : 1)));
  if (gear !== 'R' && fwd < 0) fwd = 0; // no reverse without R
  let lx = car.vx - fx * fwd, lz = car.vz - fz * fwd;
  const grip = input.hand ? 3.0 : 9.0, k = Math.exp(-grip * dt);
  lx *= k; lz *= k;
  const steerMax = 1.9 * (1 / (1 + Math.abs(fwd) * 0.02));
  car.heading += input.steer * steerMax * dt * Math.sign(fwd || 1) * Math.min(1, Math.abs(fwd) / 5 + 0.4);
  car.vx = fx * fwd + lx; car.vz = fz * fwd + lz;
  car.x += car.vx * dt; car.z += car.vz * dt;
  car.speed = fwd;
  if (car.prim) for (const w of car.wheels) w.rotation.x += fwd * dt / 0.42;
  return { np, off };
}

// ---------- Render loop ----------
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(Math.max(timer.getDelta(), 0), 0.1);
  if (mode === 'race' || mode === 'ready') {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP; raceT += STEP;
      const { np, off } = physics(STEP);
      const prog = np.i / ringPtsDense.length;
      if (prog < 0.08 && sector > 0.7 && np.d < 16) {
        if (lap >= TOTAL_LAPS) { finishRace(); break }
        lap++; sector = 0;
      } else sector = prog;
      const kmh = Math.abs(car.speed * 3.6);
      const inCity = car.x < 300 && car.z > -380 && car.z < 240;
      if (inCity && kmh > 40) { speedZoneT += STEP; if (speedZoneT > 3) { addPenalty(10, 'превышение 40'); speedZoneT = 0 } }
      else speedZoneT = Math.max(0, speedZoneT - STEP);
      if (off) { offTrackT += STEP; if (offTrackT > 10) { addPenalty(5, 'выезд за трассу'); offTrackT = 0 } }
      else offTrackT = Math.max(0, offTrackT - STEP);
      if (mode === 'finish') break;
    }
    if (car.mesh) { car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = car.heading + Math.PI / 2 }
    const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading);
    let tx, ty, tz;
    if (camMode === 'chase') { tx = car.x - fx * 13 + car.vx * 0.3; ty = 6; tz = car.z - fz * 13 + car.vz * 0.3 }
    else { tx = car.x; ty = 42; tz = car.z + 20 }
    const t = 1 - Math.exp(-5 * dt);
    camera.position.x += (tx - camera.position.x) * t; camera.position.y += (ty - camera.position.y) * t; camera.position.z += (tz - camera.position.z) * t;
    if (camMode === 'chase') camera.lookAt(car.x + car.vx * 0.5, 1.2, car.z + car.vz * 0.5);
    else camera.lookAt(car.x, 0, car.z);
    $('spd').textContent = String(Math.abs(Math.round(car.speed * 3.6)));
    $('lap').textContent = `${Math.min(lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
    $('time').textContent = fmt(raceT);
    $('wheel').style.transform = `rotate(${input.steer * 110}deg)`;
  } else if (mode === 'menu' || mode === 'prep') {
    const t = performance.now() / 1000;
    camera.position.set(car.x + Math.sin(t * 0.3) * 16, 6, car.z + Math.cos(t * 0.3) * 16);
    camera.lookAt(car.x, 1, car.z);
    if (car.mesh) { car.mesh.position.set(car.x, 0, car.z); car.mesh.rotation.y = car.heading + Math.PI / 2 }
  }
  renderer.render(scene, camera);
});
