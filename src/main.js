// Автодром — мобильный симулятор (Canvas 2D, top-down + аркадная физика)
const canvas = document.getElementById('game')
const ctx = canvas.getContext('2d')
const $ = (id) => document.getElementById(id)
$('spd'); // warm-up

const TOTAL_LAPS = 3
const TRACK = [
  { x: 0, y: 0 }, { x: 900, y: -120 }, { x: 1600, y: -500 }, { x: 1450, y: -1100 },
  { x: 700, y: -1250 }, { x: -100, y: -900 }, { x: -350, y: -350 }, { x: -200, y: 180 },
]
// checkpoints: fraction along polyline — start/finish at index 0
const CHECKPOINTS = 8
const WIDTH = 190

function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy) }
function trackLength() { let L = 0; for (let i = 0; i < TRACK.length; i++) L += dist(TRACK[i], TRACK[(i + 1) % TRACK.length]); return L }
const TLEN = trackLength()
// precompute cumulative lengths for sector logic
const CUM = [0]
for (let i = 0; i < TRACK.length; i++) CUM.push(CUM[i] + dist(TRACK[i], TRACK[(i + 1) % TRACK.length]))

function nearestParam(p) {
  let best = { d: 1e18, t: 0 }
  for (let i = 0; i < TRACK.length; i++) {
    const a = TRACK[i], b = TRACK[(i + 1) % TRACK.length]
    const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1
    let u = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
    u = Math.max(0, Math.min(1, u))
    const cx = a.x + vx * u, cy = a.y + vy * u
    const d = Math.hypot(p.x - cx, p.y - cy)
    if (d < best.d) best = { d, t: (CUM[i] + Math.hypot(cx - a.x, cy - a.y)) / TLEN, sec: i }
  }
  return best
}

// offscreen track render
const off = document.createElement('canvas')
off.width = 2600; off.height = 2000
{
  const o = off.getContext('2d')
  o.fillStyle = '#17210f'; o.fillRect(0, 0, off.width, off.height)
  // grass texture dots
  o.fillStyle = 'rgba(255,255,255,.03)'
  for (let i = 0; i < 900; i++) o.fillRect(Math.random() * off.width, Math.random() * off.height, 8, 8)
  const OX = 1300, OY = 1050
  o.lineCap = 'round'; o.lineJoin = 'round'
  const path = () => { o.beginPath(); TRACK.forEach((p, i) => i ? o.lineTo(p.x + OX, p.y + OY) : o.moveTo(p.x + OX, p.y + OY)); o.closePath() }
  // curbs outer
  o.strokeStyle = '#e9e9e9'; o.lineWidth = WIDTH + 38; path(); o.stroke()
  o.strokeStyle = '#d23b3b'; o.lineWidth = WIDTH + 16; path(); o.stroke()
  // asphalt
  o.strokeStyle = '#3a3f47'; o.lineWidth = WIDTH; path(); o.stroke()
  // center dashes
  o.strokeStyle = 'rgba(255,255,255,.55)'; o.lineWidth = 6; o.setLineDash([26, 30]); path(); o.stroke()
  o.setLineDash([])
  // start line
  const s = TRACK[0]
  o.fillStyle = '#fff'
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
    o.fillRect(s.x + OX - 24 + (i % 2) * 24, s.y + OY - 14 + j * 14, 24, 14)
  }
  // sector markers
  o.fillStyle = '#ffc933'; o.font = 'bold 20px monospace'
  TRACK.forEach((p, i) => { o.fillText(String(i), p.x + OX + 10, p.y + OY + 30) })
}

let W = 0, H = 0, DPR = 1
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2)
  const r = canvas.parentElement.getBoundingClientRect()
  W = Math.max(1, Math.floor(r.width)); H = Math.max(1, Math.floor(r.height))
  canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
}
window.addEventListener('resize', resize); resize()

// state
const input = { steer: 0, gas: 0, brake: 0, hand: 0 }
const car = { x: TRACK[0].x - 40, y: TRACK[0].y + 30, a: Math.atan2(TRACK[1].y - TRACK[0].y, TRACK[1].x - TRACK[0].x), vx: 0, vy: 0, speed: 0 }
let mode = 'menu' // menu | count | race | pause | finish
let lap = 1, best = Number(localStorage.getItem('avtodrom_best') || 0), raceT = 0, last = performance.now(), countT = 0
let sector = 0, lapTimes = [], sound = true, audio = null

function beep(f = 880, d = 0.12) {
  if (!sound) return
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)()
    const o = audio.createOscillator(), g = audio.createGain()
    o.frequency.value = f; o.type = 'square'
    g.gain.value = 0.06; o.connect(g).connect(audio.destination)
    o.start(); o.stop(audio.currentTime + d)
  } catch {}
}
function engineTone() {
  if (!sound || !audio) return
  // thin engine: short tick pitch follows speed
  const f = 60 + Math.min(600, Math.abs(car.speed) * 6)
  if (Math.random() < 0.06) beep(f, 0.05)
}

function resetCar(silent) {
  car.x = TRACK[0].x - 40; car.y = TRACK[0].y + 30
  car.a = Math.atan2(TRACK[1].y - TRACK[0].y, TRACK[1].x - TRACK[0].x)
  car.vx = car.vy = 0; car.speed = 0; sector = 0
  if (!silent) beep(300, 0.08)
}
function startRace() {
  resetCar(true); lap = 1; raceT = 0; lapTimes = []; sector = 0; mode = 'count'; countT = 3.0
  $('menu').style.display = 'none'; $('finish').classList.remove('show')
  beep(440, 0.08)
}
function finishRace() {
  mode = 'finish'; beep(1200, 0.25)
  const total = lapTimes.reduce((a, b) => a + b, 0)
  if (!best || total < best) { best = total; localStorage.setItem('avtodrom_best', String(best)) }
  $('finishTxt').innerHTML = `Общее время: <b>${fmt(total)}</b><br/>Круги: ${lapTimes.map(fmt).join(' · ')}<br/>Рекорд: <b>${fmt(best)}</b>`
  $('finish').classList.add('show')
}
const fmt = (t) => { const m = Math.floor(t / 60), s = (t % 60).toFixed(2); return `${m}:${s.padStart(5, '0')}` }

// input: keyboard
const keys = {}
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; if (e.code === 'Space') e.preventDefault() })
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false })
function pollKeys() {
  input.steer = (keys['arrowright'] || keys['d'] ? 1 : 0) - (keys['arrowleft'] || keys['a'] ? 1 : 0)
  input.gas = keys['arrowup'] || keys['w'] ? 1 : 0
  input.brake = keys['arrowdown'] || keys['s'] ? 1 : 0
  input.hand = keys[' '] ? 1 : 0
}
// touch buttons
function bindBtn(id, key, val = 1) {
  const el = $(id)
  const on = (e) => { e.preventDefault(); input[key] = val; el.setPointerCapture?.(e.pointerId) }
  const off = (e) => { e.preventDefault(); input[key] = 0 }
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off)
}
bindBtn('btnGas', 'gas', 1); bindBtn('btnBrake', 'brake', 1); bindBtn('btnHand', 'hand', 1)
bindBtn('btnLeft', 'steer', -1); bindBtn('btnRight', 'steer', 1)
// drag-steer fallback: touch-drag on left half steers
let dragSteer = false, dragX0 = 0
canvas.addEventListener('pointerdown', (e) => { if (e.clientX < W * 0.55) { dragSteer = true; dragX0 = e.clientX } })
canvas.addEventListener('pointermove', (e) => { if (dragSteer) input.steer = Math.max(-1, Math.min(1, (e.clientX - dragX0) / 90)) })
canvas.addEventListener('pointerup', () => { dragSteer = false; if (input.steer && !keys['arrowleft'] && !keys['arrowright']) input.steer = 0 })
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'race') mode = 'pause' })

$('btnStart').onclick = startRace
$('btnRestart').onclick = startRace
$('btnToMenu').onclick = () => { mode = 'menu'; $('finish').classList.remove('show'); $('menu').style.display = 'flex' }
$('btnReset').onclick = () => resetCar()
$('btnPause').onclick = () => { if (mode === 'race') mode = 'pause'; else if (mode === 'pause') mode = 'race' }
$('btnSound').onclick = () => { sound = !sound; $('btnSound').textContent = sound ? '🔊 Звук вкл' : '🔇 Звук выкл' }

function physics(dt) {
  pollKeys()
  const MAX = 58, ACC = 26, BRK = 38
  // speed along heading
  const fx = Math.cos(car.a), fy = Math.sin(car.a)
  let fwd = car.vx * fx + car.vy * fy
  if (input.gas) fwd += ACC * dt
  if (input.brake) { if (fwd > 1) fwd -= BRK * dt; else fwd -= 10 * dt }
  // drag + off-track
  const np = nearestParam(car)
  const offTrack = np.d > WIDTH / 2
  fwd *= Math.exp(-(input.hand ? 0.55 : 0.18) * dt)
  if (offTrack) fwd *= Math.exp(-1.9 * dt)
  fwd = Math.max(-14, Math.min(fwd, MAX * (offTrack ? 0.55 : 1)))
  // lateral grip
  let lx = car.vx - fx * fwd, ly = car.vy - fy * fwd
  const grip = input.hand ? 3.2 : 9.5
  const k = Math.exp(-grip * dt)
  lx *= k; ly *= k
  // steering: less at speed
  const steerMax = 2.35 * (1 / (1 + Math.abs(fwd) * 0.028))
  car.a += input.steer * steerMax * dt * Math.sign(fwd || 1) * Math.min(1, Math.abs(fwd) / 6 + 0.35)
  car.vx = fx * fwd + lx; car.vy = fy * fwd + ly
  car.x += car.vx * dt; car.y += car.vy * dt
  car.speed = fwd
  engineTone()
  if (navigator.vibrate && offTrack && Math.abs(fwd) > 8 && Math.random() < 0.05) navigator.vibrate(8)
  return np
}

function update(dt) {
  if (mode === 'count') {
    countT -= dt
    if (countT <= 2.0 && countT > 1.9) beep(440, 0.08)
    if (countT <= 1.0 && countT > 0.9) beep(440, 0.08)
    if (countT <= 0) { mode = 'race'; raceT = 0; beep(880, 0.18) }
    return
  }
  if (mode !== 'race') return
  raceT += dt
  const np = physics(dt)
  // sector / lap: sectors 0..7, lap when crossing start after all hit in order
  const expect = (Math.floor(np.t * CHECKPOINTS) + 1) % CHECKPOINTS
  if (expect === sector || np.t < 0.06 || np.t > 0.94) { /* near start/finish band */ }
  if (np.t < 0.5 && sector > CHECKPOINTS - 2 && np.d < WIDTH * 0.75) {
    // crossed start/finish
    lapTimes.push(raceT - (lapTimes.reduce((a, b) => a + b, 0)))
    if (lap >= TOTAL_LAPS) finishRace()
    else { lap++; beep(700, 0.12) }
    sector = 0
  } else {
    const idx = Math.floor(np.t * CHECKPOINTS) % CHECKPOINTS
    if ((idx === 0 && sector === CHECKPOINTS - 1) || idx !== sector) sector = idx
  }
}

function draw() {
  ctx.fillStyle = '#17210f'; ctx.fillRect(0, 0, W, H)
  const zoom = Math.min(W, H) / 620
  const camX = car.x + car.vx * 0.45, camY = car.y + car.vy * 0.45
  ctx.save()
  ctx.translate(W / 2 - camX * zoom, H / 2 - camY * zoom)
  ctx.scale(zoom, zoom)
  ctx.drawImage(off, -1300, -1050)
  // car
  ctx.save()
  ctx.translate(car.x, car.y); ctx.rotate(car.a)
  ctx.fillStyle = '#ff4d4d'; ctx.fillRect(-18, -9, 36, 18)
  ctx.fillStyle = '#202635'; ctx.fillRect(-8, -9, 14, 18)
  ctx.fillStyle = '#dce6ff'; ctx.fillRect(-4, -6, 8, 12)
  ctx.fillStyle = '#111'; ctx.fillRect(10, -10, 10, 5); ctx.fillRect(10, 5, 10, 5); ctx.fillRect(-18, -10, 8, 5); ctx.fillRect(-18, 5, 8, 5)
  ctx.restore()
  // countdown
  ctx.restore()
  if (mode === 'count') {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#ffc933'; ctx.font = '900 80px system-ui'; ctx.textAlign = 'center'
    ctx.fillText(String(Math.ceil(countT)), W / 2, H / 2 + 20)
    ctx.font = '700 16px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText('Приготовьтесь…', W / 2, H / 2 + 60)
  }
  if (mode === 'pause') {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#fff'; ctx.font = '800 30px system-ui'; ctx.textAlign = 'center'
    ctx.fillText('⏸ Пауза', W / 2, H / 2); ctx.font = '15px system-ui'; ctx.fillText('Нажмите ⏸ чтобы продолжить', W / 2, H / 2 + 34)
  }
  // minimap
  const mw = 110, mh = 110, mx = W - mw - 14, my = 52
  ctx.fillStyle = 'rgba(8,12,20,.65)'; roundRect(ctx, mx, my, mw, mh, 12); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke()
  ctx.strokeStyle = '#8be28b'; ctx.lineWidth = 3; ctx.beginPath()
  TRACK.forEach((p, i) => { const px = mx + 20 + (p.x + 450) / 2100 * (mw - 40), py = my + 20 + (p.y + 1350) / 2700 * (mh - 40); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py) })
  ctx.closePath(); ctx.stroke()
  const cpx = mx + 20 + (car.x + 450) / 2100 * (mw - 40), cpy = my + 20 + (car.y + 1350) / 2700 * (mh - 40)
  ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(cpx, cpy, 4.5, 0, 7); ctx.fill()

  $('spd').textContent = String(Math.abs(Math.round(car.speed * 3.6)))
  $('lap').textContent = `${Math.min(lap, TOTAL_LAPS)}/${TOTAL_LAPS}`
  $('time').textContent = fmt(raceT)
  $('best').textContent = best ? fmt(best) : '--'
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath() }

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now
  update(dt); draw()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)