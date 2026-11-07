extends Node3D
# Avtodrom Godot v3 — Kyzylorda free ride + EXAM autodrom (13 exercises, own geometry).
# Standard public exam elements; no third-party models copied. Car/Spectral GLB CC0.

class WheelCtl:
	extends Control
	var steer := 0.0
	func _draw() -> void:
		var c := size * 0.5
		var r := minf(size.x, size.y) * 0.42
		draw_circle(c, r + 9.0, Color(0.05, 0.07, 0.1, 0.55))
		draw_arc(c, r, 0.0, TAU, 64, Color(0.85, 0.87, 0.92, 0.95), 12.0, true)
		draw_arc(c, r - 14.0, 0.0, TAU, 64, Color(0.4, 0.45, 0.52, 0.9), 3.0, true)
		var a := steer * 1.8
		for k in range(3):
			var ang := a + float(k) * TAU / 3.0
			var from := c + Vector2(0.0, -1.0).rotated(ang) * 18.0
			var to := c + Vector2(0.0, -1.0).rotated(ang) * (r - 4.0)
			draw_line(from, to, Color(0.35, 0.4, 0.47, 0.95), 10.0, true)
		draw_circle(c, 24.0, Color(0.88, 0.9, 0.93, 0.98))
		draw_arc(c, 24.0, 0.0, TAU, 32, Color(0.2, 0.24, 0.3, 0.9), 2.5, true)

var wheel: WheelCtl
var wheel_drag := false
var keys := {"left": false, "right": false}

const TOTAL_LAPS := 3
const TOP_SPEED := 33.0
const GEARS := {"R": 8.0, "N": 0.0, "1": 14.0, "2": 22.0, "3": 29.0, "4": 36.0, "5": 42.0}
var gear: String = "N"

var car: VehicleBody3D
var cam: Camera3D
var mode: String = "menu" # menu | prep | race | finish
var free_mode := true     # true = Kyzylorda + ring, false = exam ground
var lap := 1
var race_t := 0.0
var pen_time := 0.0
var sector := 0.0
var speed_zone_t := 0.0
var off_track_t := 0.0
var penalties: Array = []
var expr_idx := 0
var stopped_at := {}      # zone id -> bool (stop confirmed)

var hud_speed: Label
var hud_lap: Label
var hud_time: Label
var hud_pen: Label
var hud_gear: Label
var hud_expr: Label
var toast_label: Label
var toast_timer := 0.0
var menu_layer: CanvasLayer
var prep_layer: CanvasLayer
var prep_overlay: PanelContainer
var prep_boxes: Array[CheckBox] = []
var finish_overlay: PanelContainer
var finish_text: Label

var touch_steer := 0.0
var touch_gas := false
var touch_brake := false
var touch_hand := false

var ring: Array[Vector3] = []
var ring_n := 360
var zones: Array = []       # {"id": String, "name": String, "area": Area3D, "kind": String}

const EXERCISES: Array[String] = [
	"1. Старт с линии",
	"2. Эстакада (стоп на подъёме)",
	"3. Змейка (конусы)",
	"4. Разворот в ограниченном пространстве",
	"5. Заезд в бокс (параллельная парковка)",
	"6. Пешеходный переход",
	"7. Железнодорожный переезд",
	"8. Поворот налево на кольце",
	"9. Заезд в бокс задним ходом",
	"10. Выезд с эстакады",
	"11. Движение по прямой со скоростью",
	"12. Остановка у линии СТОП",
	"13. Финишная линия",
]

func _ready() -> void:
	if DisplayServer.get_name() == "headless":
		return
	_ensure_input_actions()
	_build_environment()
	_build_map()
	_build_exam_ground()
	_build_car()
	_build_camera()
	_build_hud()
	_build_menus()
	_spawn_at_start()

func _ensure_input_actions() -> void:
	_bind("steer_left", KEY_LEFT)
	_bind("steer_right", KEY_RIGHT)
	_bind("throttle", KEY_W)
	_bind("brake", KEY_S)
	_bind("handbrake", KEY_SPACE)

func _bind(action: StringName, key: int) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)
		var ev := InputEventKey.new()
		ev.physical_keycode = key
		InputMap.action_add_event(action, ev)

# ---------- environment / helpers ----------
func _build_environment() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.1
	env.fog_enabled = true
	env.fog_light_color = Color(0.53, 0.71, 0.84)
	env.fog_density = 0.0012
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	add_child(sun)

func _mat(c: Color, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m

func _box(size: Vector3, pos: Vector3, c: Color, solid := true, parent: Node = null) -> CSGBox3D:
	var b := CSGBox3D.new()
	b.size = size
	b.position = pos
	b.material = _mat(c)
	b.use_collision = solid
	(self if parent == null else parent).add_child(b)
	return b

func _label3d(text: String, pos: Vector3, col := Color.WHITE, size := 32) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.position = pos
	l.font_size = size
	l.modulate = col
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	add_child(l)
	return l

# ---------- Kyzylorda + ring (free ride) ----------
func _build_map() -> void:
	_box(Vector3(2400, 1, 1600), Vector3(0, -0.55, 0), Color(0.79, 0.69, 0.46), false)
	_box(Vector3(920, 0.6, 660), Vector3(-260, -0.3, -40), Color(0.56, 0.6, 0.5), false)
	_box(Vector3(620, 0.6, 520), Vector3(600, -0.3, -230), Color(0.33, 0.36, 0.39), false)
	_box(Vector3(150, 0.4, 2100), Vector3(-60, 0, 340), Color(0.18, 0.56, 0.71), false).rotation_degrees.y = 25.7
	_road(Vector2(-650, -80), Vector2(250, -80), 18.0)
	_road(Vector2(-180, -350), Vector2(-180, 220), 16.0)
	_road(Vector2(-380, -350), Vector2(-380, 220), 14.0)
	_road(Vector2(40, -320), Vector2(40, 180), 14.0)
	_road(Vector2(-650, 180), Vector2(250, 180), 22.0)
	_road(Vector2(-180, 180), Vector2(-180, 520), 16.0)
	_road(Vector2(-650, -300), Vector2(250, -300), 14.0)
	_road(Vector2(180, -350), Vector2(180, 220), 14.0)
	for bx in [-180.0, 40.0]:
		_box(Vector3(20, 2, 220), Vector3(bx, 1.0, 340), Color(0.33, 0.36, 0.39))
	_box(Vector3(150, 0.4, 110), Vector3(90, 0.1, -190), Color(0.25, 0.56, 0.25), false)
	_box(Vector3(70, 14, 48), Vector3(90, 7, -190), Color(0.85, 0.85, 0.85))
	var rng := RandomNumberGenerator.new()
	rng.seed = 42
	for gx in range(-620, 221, 56):
		for gz in range(-330, 161, 56):
			if absf(gx + 180) < 30 or absf(gz + 80) < 30 or absf(gx - 40) < 27 or absf(gx + 380) < 25 or absf(gx - 180) < 27:
				continue
			if absf(gz + 300) < 20:
				continue
			if gx > 30 and gx < 190 and gz > -260 and gz < -120:
				continue
			if ((gx + gz) * 37) % 11 < 3:
				continue
			var h := rng.randf_range(9.0, 20.0)
			_box(Vector3(20, h, 20), Vector3(gx, h * 0.5, gz), Color(0.81, 0.83, 0.85))
	for i in range(56):
		var in_park := i < 40
		var x := 25.0 + float((i * 37) % 130) if in_park else -630.0 + float(i * 53 % 880)
		var z := -235.0 + float((i * 53) % 90) if in_park else (-68.0 if i % 2 == 0 else 192.0)
		_box(Vector3(0.6, 2.0, 0.6), Vector3(x, 1.0, z), Color(0.4, 0.28, 0.18), false)
		var cone := MeshInstance3D.new()
		var cm := PrismMesh.new()
		cm.size = Vector3(4.5, 8.0, 4.5)
		cm.left_to_right = 0.5
		cone.mesh = cm
		cone.material_override = _mat(Color(0.18, 0.42, 0.18))
		cone.position = Vector3(x, 6.0, z)
		add_child(cone)
	_label3d("Абай", Vector3(-400, 10, -68), Color(1.0, 0.8, 0.2))
	_label3d("Назарбаев", Vector3(-200, 10, -200), Color(1.0, 0.8, 0.2))
	_label3d("Сырдарья", Vector3(300, 10, 420), Color(1.0, 0.8, 0.2))
	_build_ring()

func _road(a: Vector2, b: Vector2, w: float) -> void:
	var d := b - a
	var len := d.length()
	var yaw := rad_to_deg(atan2(d.x, d.y))
	var r := _box(Vector3(w, 0.35, len), Vector3((a.x + b.x) * 0.5, 0.1, (a.y + b.y) * 0.5), Color(0.23, 0.25, 0.28))
	r.rotation_degrees.y = yaw

func _build_ring() -> void:
	var ctrl: Array[Vector3] = [
		Vector3(520, 0, -40), Vector3(760, 0, -60), Vector3(900, 0, -200),
		Vector3(860, 0, -360), Vector3(620, 0, -430), Vector3(480, 0, -330),
		Vector3(430, 0, -220), Vector3(500, 0, -150),
	]
	var curve := Curve3D.new()
	curve.add_point(ctrl[0])
	for i in range(1, ctrl.size()):
		curve.add_point(ctrl[i])
	curve.add_point(ctrl[0])
	ring.clear()
	ring.resize(ring_n)
	for i in range(ring_n):
		ring[i] = curve.sample_baked(float(i) / float(ring_n) * curve.get_baked_length())
	for i in range(ring_n):
		var p := ring[i]
		var q := ring[(i + 1) % ring_n]
		var t := (q - p)
		var len := t.length()
		if len < 0.01:
			continue
		var yaw := rad_to_deg(atan2(t.x, t.z))
		var seg := _box(Vector3(18, 0.3, len + 0.5), Vector3((p.x + q.x) * 0.5, 0.05, (p.z + q.z) * 0.5), Color(0.23, 0.25, 0.28))
		seg.rotation_degrees.y = yaw
	var p0: Vector3 = ring[0]
	var t0: Vector3 = (ring[4] - ring[0]).normalized()
	var g0 := p0 + t0 * 3.0
	_box(Vector3(2, 2.2, 24), Vector3(g0.x, 9, g0.z), Color(0.08, 0.1, 0.14))
	_box(Vector3(2, 9, 2), Vector3(g0.x, 4.5, g0.z - 11), Color(0.13, 0.16, 0.22))
	_box(Vector3(2, 9, 2), Vector3(g0.x, 4.5, g0.z + 11), Color(0.13, 0.16, 0.22))
	_box(Vector3(0.5, 2, 22), Vector3(g0.x + 1.2, 9, g0.z), Color(1.0, 0.79, 0.2), false)

func _nearest_on_ring(pos: Vector3) -> Dictionary:
	var best_d := 1e9
	var best_i := 0
	for i in range(ring.size()):
		var d := ring[i].distance_to(pos)
		if d < best_d:
			best_d = d
			best_i = i
	return {"d": best_d, "i": best_i}

# ---------- Exam autodrom ground (own geometry, standard public elements) ----------
# Ground centre (1500, -850), size 240x160. Entrance from ring at (900,-200) to (1300,-700).
const EXAM_C := Vector2(1500, -850)

func _build_exam_ground() -> void:
	var c := EXAM_C
	# asphalt pad + fence
	_box(Vector3(240, 0.4, 160), Vector3(c.x, -0.1, c.y), Color(0.3, 0.32, 0.35), false)
	_box(Vector3(240, 2.5, 1), Vector3(c.x, 1.2, c.y - 80), Color(0.7, 0.72, 0.75))
	_box(Vector3(240, 2.5, 1), Vector3(c.x, 1.2, c.y + 80), Color(0.7, 0.72, 0.75))
	_box(Vector3(1, 2.5, 160), Vector3(c.x - 120, 1.2, c.y), Color(0.7, 0.72, 0.75))
	_box(Vector3(1, 2.5, 160), Vector3(c.x + 120, 1.2, c.y), Color(0.7, 0.72, 0.75))
	# entrance road to ring
	_road(Vector2(900, -200), Vector2(1380, -700), 14.0)
	# start/finish line
	_box(Vector3(10, 0.15, 3), Vector3(c.x, 0.1, c.y - 20), Color(1, 1, 1), false)
	_label3d("СТАРТ/ФИНИШ", Vector3(c.x, 6, c.y - 20), Color.WHITE)
	_make_zone("start", "1. Старт", Vector3(c.x, 1, c.y - 20), Vector3(12, 4, 8))
	# stop sign
	_box(Vector3(4, 0.15, 3), Vector3(c.x, 0.1, c.y + 5), Color(1, 0.25, 0.25), false)
	_box(Vector3(2.2, 2.2, 0.4), Vector3(c.x, 3.2, c.y + 6), Color(0.85, 0.1, 0.1), false)
	_make_zone("stop1", "12. СТОП", Vector3(c.x, 1, c.y + 5), Vector3(10, 4, 8))
	# estakada ramp (12m long, 3m high, 5m wide) + its stop line
	var ramp := _box(Vector3(5, 6.8, 13), Vector3(c.x + 40, 1.4, c.y), Color(0.45, 0.46, 0.5))
	var rv := Vector3(0, 0, 0)
	# slope: rotate around X
	ramp.rotation_degrees.x = -14.0
	_box(Vector3(6, 0.15, 3), Vector3(c.x + 40, 3.3, c.y + 4), Color(1, 1, 1), false)
	_label3d("ЭСТАКАДА", Vector3(c.x + 40, 8, c.y), Color.WHITE)
	_make_zone("estakada", "2. Эстакада", Vector3(c.x + 40, 2, c.y + 1), Vector3(7, 6, 14))
	# snake: 4 cones slalom
	for i in range(4):
		var cx := c.x - 40 + i * 9.0
		_cone(Vector3(cx, 0, c.y + 30))
	_label3d("ЗМЕЙКА", Vector3(c.x - 28, 6, c.y + 30), Color.WHITE)
	_make_zone("snake", "3. Змейка", Vector3(c.x - 28 + 13, 1, c.y + 30), Vector3(40, 4, 10))
	# uturn square
	_box(Vector3(14, 0.1, 1), Vector3(c.x - 70, 0.1, c.y + 10), Color(1, 1, 1), false)
	_box(Vector3(14, 0.1, 1), Vector3(c.x - 70, 0.1, c.y + 24), Color(1, 1, 1), false)
	_box(Vector3(1, 0.1, 14), Vector3(c.x - 77, 0.1, c.y + 17), Color(1, 1, 1), false)
	_box(Vector3(1, 0.1, 14), Vector3(c.x - 63, 0.1, c.y + 17), Color(1, 1, 1), false)
	_label3d("РАЗВОРОТ", Vector3(c.x - 70, 6, c.y + 17), Color.WHITE)
	_make_zone("uturn", "4. Разворот", Vector3(c.x - 70, 1, c.y + 17), Vector3(14, 4, 14))
	# parking box (parallel)
	_box(Vector3(12, 0.1, 5), Vector3(c.x + 80, 0.1, c.y - 40), Color(0.2, 0.4, 0.9), false)
	_label3d("БОКС (парковка)", Vector3(c.x + 80, 6, c.y - 40), Color(0.6, 0.8, 1.0))
	_make_zone("box", "5. Бокс", Vector3(c.x + 80, 1, c.y - 40), Vector3(12, 4, 6))
	# zebra + pedestrian
	for i in range(5):
		_box(Vector3(0.8, 0.1, 6), Vector3(c.x + 20 + float(i), 0.1, c.y - 60), Color(1, 1, 1), false)
	_box(Vector3(1.2, 3.6, 1.2), Vector3(c.x + 22, 1.8, c.y - 60), Color(0.2, 0.2, 0.85), false)
	_label3d("ПЕРЕХОД", Vector3(c.x + 22, 6, c.y - 60), Color.WHITE)
	_make_zone("zebra", "6. Переход", Vector3(c.x + 22, 1, c.y - 60), Vector3(9, 4, 8))
	# rail crossing: striped board + barrier
	_box(Vector3(8, 1.4, 0.8), Vector3(c.x - 20, 1.4, c.y - 60), Color(1, 1, 1), false)
	_box(Vector3(8, 0.35, 0.4), Vector3(c.x - 20, 2.6, c.y - 60), Color(0.85, 0.1, 0.1), false)
	_label3d("ЖД ПЕРЕЕЗД", Vector3(c.x - 20, 6, c.y - 60), Color(1.0, 0.5, 0.3))
	_make_zone("rail", "7. ЖД переезд", Vector3(c.x - 20, 1, c.y - 60), Vector3(10, 4, 8))
	# left-turn T mark
	_box(Vector3(16, 0.1, 1), Vector3(c.x - 20, 0.1, c.y - 5), Color(1, 1, 1), false)
	_label3d("ПОВОРОТ НАЛЕВО", Vector3(c.x - 20, 6, c.y - 5), Color.WHITE)
	_make_zone("leftturn", "8. Поворот налево", Vector3(c.x - 20, 1, c.y - 2), Vector3(16, 4, 10))
	# finish line
	_box(Vector3(10, 0.15, 3), Vector3(c.x, 0.1, c.y + 60), Color(1, 1, 1), false)
	_label3d("ФИНИШ", Vector3(c.x, 6, c.y + 60), Color(1.0, 0.8, 0.2))
	_make_zone("finish", "13. Финиш", Vector3(c.x, 1, c.y + 60), Vector3(12, 4, 8))

func _cone(p: Vector3) -> void:
	var base := _box(Vector3(0.8, 0.15, 0.8), Vector3(p.x, 0.1, p.z), Color(0.85, 0.2, 0.1), false)
	var top := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.05
	cm.bottom_radius = 0.35
	cm.height = 0.9
	top.mesh = cm
	top.material_override = _mat(Color(0.85, 0.2, 0.1))
	top.position = Vector3(p.x, 0.6, p.z)
	add_child(top)
	var a := Area3D.new()
	var shape := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(1.2, 1.2, 1.2)
	shape.shape = bs
	a.add_child(shape)
	a.position = Vector3(p.x, 0.6, p.z)
	a.set_meta("cone", true)
	add_child(a)
	a.body_entered.connect(_on_cone_hit.bind(a))

func _make_zone(id: String, zn_name: String, center: Vector3, size: Vector3) -> void:
	var a := Area3D.new()
	var shape := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	shape.shape = bs
	a.add_child(shape)
	a.position = center
	a.monitoring = true
	a.set_meta("zone_id", id)
	a.set_meta("zone_name", zn_name)
	add_child(a)
	a.body_entered.connect(_on_zone_entered.bind(a))

func _on_zone_entered(body: Node3D, area: Area3D) -> void:
	if body != car or mode != "race" or free_mode:
		return
	var zid: String = str(area.get_meta("zone_id", ""))
	var zname: String = str(area.get_meta("zone_name", zid))
	if expr_idx >= 0 and expr_idx < zones_order.size() and zid == zones_order[expr_idx]:
		# stop zones require full stop
		if zid in ["stop1", "estakada", "zebra", "rail"]:
			if car.linear_velocity.length() > 0.8:
				_add_penalty(8, "проезд без остановки")
			else:
				stopped_at[zid] = true
		expr_idx += 1
		_toast("✓ %s" % zname)
		_refresh_hud()
		if expr_idx >= zones_order.size():
			_finish_race()
	else:
		_add_penalty(5, "вне задания")

var zones_order: Array[String] = ["start", "stop1", "estakada", "snake", "uturn", "box", "leftturn", "zebra", "rail", "finish"]
var cone_cool := 0.0

func _on_cone_hit(body: Node3D, _area: Area3D) -> void:
	if body != car or mode != "race" or free_mode:
		return
	if cone_cool > 0.0:
		return
	cone_cool = 2.0
	_add_penalty(5, "сбит конус")

# ---------- car ----------
func _build_car() -> void:
	car = VehicleBody3D.new()
	car.name = "Car"
	car.mass = 1200.0
	var shape := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(2.2, 0.9, 4.6)
	shape.shape = bs
	shape.position = Vector3(0, 0.6, 0)
	car.add_child(shape)
	add_child(car)
	_add_wheel(Vector3(-1.1, 0.45, 1.5), true)
	_add_wheel(Vector3(1.1, 0.45, 1.5), true)
	_add_wheel(Vector3(-1.1, 0.45, -1.5), false)
	_add_wheel(Vector3(1.1, 0.45, -1.5), false)
	var glb: PackedScene = load("res://models/spectral_gt_rs.glb")
	if glb != null:
		var m := glb.instantiate() as Node3D
		m.rotation_degrees.y = 90.0
		car.add_child(m)
	else:
		_box(Vector3(2.2, 0.7, 4.6), Vector3(0, 0.6, 0), Color(0.88, 0.19, 0.19), false, car)
		_box(Vector3(1.8, 0.55, 2.2), Vector3(0, 1.15, -0.2), Color(0.12, 0.15, 0.23), false, car)

func _add_wheel(pos: Vector3, front: bool) -> void:
	var w := VehicleWheel3D.new()
	w.transform.origin = pos
	w.wheel_radius = 0.42
	w.suspension_rest_length = 0.35
	w.suspension_travel = 0.5
	w.suspension_max_force = 18000.0
	w.damping_compression = 4500.0
	w.damping_relaxation = 5000.0
	w.friction_slip = 1.0
	w.steering = 0.0
	car.add_child(w)

func _spawn_at_start() -> void:
	if free_mode:
		if ring.is_empty():
			return
		var p0: Vector3 = ring[0]
		var p1: Vector3 = ring[4]
		car.global_position = Vector3(p0.x, 1.2, p0.z)
		car.look_at(Vector3(p1.x, 1.2, p1.z), Vector3.UP)
	else:
		car.global_position = Vector3(EXAM_C.x, 1.2, EXAM_C.y - 30)
		car.look_at(Vector3(EXAM_C.x, 1.2, EXAM_C.y - 20), Vector3.UP)
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	car.engine_force = 0.0
	car.brake = 0.0
	car.steering = 0.0
	sector = 0.0
	expr_idx = 0
	stopped_at.clear()
	if cam != null:
		_snap_camera()

func _snap_camera() -> void:
	if car == null or cam == null:
		return
	var fwd := -car.global_transform.basis.z
	cam.global_position = car.global_position + (-fwd * 13.0) + Vector3(0, 6.0, 0)
	cam.look_at(car.global_position + Vector3(0, 1.2, 0), Vector3.UP)

# ---------- camera ----------
func _build_camera() -> void:
	cam = Camera3D.new()
	cam.fov = 62.0
	cam.current = true
	add_child(cam)

func _update_camera(delta: float) -> void:
	if car == null:
		return
	var fwd := -car.global_transform.basis.z
	var target_t := car.global_position + (-fwd * 13.0) + Vector3(0, 6.0, 0) + car.linear_velocity * 0.3
	var t := 1.0 - exp(-5.0 * delta)
	cam.global_position = cam.global_position.lerp(target_t, t)
	cam.look_at(car.global_position + car.linear_velocity * 0.5 + Vector3(0, 1.2, 0), Vector3.UP)

# ---------- UI ----------
func _build_hud() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 5
	add_child(layer)
	var top := HBoxContainer.new()
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.add_theme_constant_override("separation", 8)
	layer.add_child(top)
	hud_speed = _pill(top, "Скорость 0 км/ч")
	hud_gear = _pill(top, "N")
	hud_lap = _pill(top, "Круг 1/3")
	hud_time = _pill(top, "0:00.00")
	hud_pen = _pill(top, "+штраф 0с")
	hud_expr = _pill(top, "")
	toast_label = Label.new()
	toast_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.add_theme_font_size_override("font_size", 20)
	layer.add_child(toast_label)
	_build_wheel(layer)
	_pedal(layer, "▲\nГО", Control.PRESET_BOTTOM_RIGHT, -100, -160, -10, -40, Color(0.12, 0.55, 0.25), func() -> void: touch_gas = true, func() -> void: touch_gas = false)
	_pedal(layer, "■\nСТОП", Control.PRESET_BOTTOM_RIGHT, -190, -140, -110, -40, Color(0.62, 0.16, 0.13), func() -> void: touch_brake = true, func() -> void: touch_brake = false)
	_pedal(layer, "P\nРУЧНИК", Control.PRESET_BOTTOM_RIGHT, -110, -360, -20, -300, Color(0.2, 0.24, 0.3), func() -> void: touch_hand = true, func() -> void: touch_hand = false)
	var gr := HBoxContainer.new()
	gr.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	gr.position = Vector2(210, -60)
	layer.add_child(gr)
	for g in ["R", "N", "1", "2", "3", "4", "5"]:
		var b := Button.new()
		b.text = g
		b.custom_minimum_size = Vector2(46, 46)
		b.pressed.connect(_set_gear.bind(g))
		gr.add_child(b)
	_build_gear_gate(layer)

func _pill(parent: Node, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 16)
	parent.add_child(l)
	return l

func _abtn(parent: Node, text: String, preset: int, l: float, t: float, r: float, b: float, down: Callable, up: Callable) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.set_anchors_and_offsets_preset(preset)
	btn.offset_left = l
	btn.offset_top = t
	btn.offset_right = r
	btn.offset_bottom = b
	btn.button_down.connect(down)
	btn.button_up.connect(up)
	parent.add_child(btn)
	return btn

func _build_wheel(layer: CanvasLayer) -> void:
	wheel = WheelCtl.new()
	wheel.custom_minimum_size = Vector2(168, 168)
	wheel.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	wheel.offset_left = 16
	wheel.offset_top = -196
	wheel.offset_right = 184
	wheel.offset_bottom = -28
	wheel.mouse_filter = Control.MOUSE_FILTER_STOP
	wheel.gui_input.connect(_on_wheel_input)
	layer.add_child(wheel)

func _on_wheel_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		wheel_drag = (event as InputEventMouseButton).pressed
		if wheel_drag:
			_wheel_drag_to()
	if wheel_drag and (event is InputEventMouseMotion or event is InputEventScreenDrag):
		_wheel_drag_to()
	if event is InputEventMouseButton and not (event as InputEventMouseButton).pressed:
		wheel_drag = false
		if not keys["left"] and not keys["right"]:
			touch_steer = 0.0
			wheel.steer = 0.0

func _wheel_drag_to() -> void:
	var lp := wheel.get_local_mouse_position()
	var d := lp - wheel.size * 0.5
	var ang := atan2(d.x, -d.y)
	touch_steer = clampf(ang / 1.9, -1.0, 1.0)
	wheel.steer = touch_steer

func _pedal(parent: Node, text: String, preset: int, l: float, t: float, r: float, b: float, col: Color, down: Callable, up: Callable) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.set_anchors_and_offsets_preset(preset)
	btn.offset_left = l
	btn.offset_top = t
	btn.offset_right = r
	btn.offset_bottom = b
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.corner_radius_top_left = 18
	sb.corner_radius_top_right = 18
	sb.corner_radius_bottom_left = 18
	sb.corner_radius_bottom_right = 18
	sb.border_width_left = 2
	sb.border_width_top = 2
	sb.border_width_right = 2
	sb.border_width_bottom = 4
	sb.border_color = Color(1, 1, 1, 0.35)
	btn.add_theme_stylebox_override("normal", sb)
	var sb2 := sb.duplicate() as StyleBoxFlat
	sb2.bg_color = col.darkened(0.35)
	btn.add_theme_stylebox_override("pressed", sb2)
	btn.add_theme_font_size_override("font_size", 20)
	btn.button_down.connect(down)
	btn.button_up.connect(up)
	parent.add_child(btn)
	return btn

func _set_gear(g: String) -> void:
	gear = g
	if hud_gear != null:
		hud_gear.text = g
	if knob != null and knob_slots.has(g):
		_move_knob_to(g)

# ---------- draggable H-gate gearbox ----------
var gate: Control
var knob: Button
var knob_dragging := false
var knob_anim := 1.0
var knob_from := Vector2.ZERO
var knob_to := Vector2.ZERO
var knob_slots := {"R": Vector2(10, 0), "1": Vector2(65, 0), "3": Vector2(120, 0), "N": Vector2(65, 55), "2": Vector2(10, 110), "4": Vector2(65, 110), "5": Vector2(120, 110)}

func _build_gear_gate(layer: CanvasLayer) -> void:
	gate = Control.new()
	gate.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	gate.offset_left = -220
	gate.offset_top = -295
	gate.offset_right = -40
	gate.offset_bottom = -175
	layer.add_child(gate)
	var bg := ColorRect.new()
	bg.color = Color(0.08, 0.1, 0.14, 0.85)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	gate.add_child(bg)
	var title := Label.new()
	title.text = "КПП"
	title.position = Vector2(70, 130)
	title.add_theme_font_size_override("font_size", 14)
	gate.add_child(title)
	for g in ["R", "1", "3", "N", "2", "4", "5"]:
		var l := Label.new()
		l.text = g
		l.position = knob_slots[g] + Vector2(10, 8)
		l.add_theme_font_size_override("font_size", 18)
		gate.add_child(l)
	knob = Button.new()
	knob.text = "●"
	knob.custom_minimum_size = Vector2(44, 44)
	knob.size = Vector2(44, 44)
	knob.position = knob_slots["N"]
	knob.button_down.connect(_knob_down)
	knob.button_up.connect(_knob_up)
	gate.add_child(knob)

func _knob_down() -> void:
	knob_dragging = true

func _knob_up() -> void:
	if not knob_dragging:
		return
	knob_dragging = false
	var best := "N"
	var bd := 1e9
	for g in knob_slots:
		var d := knob.position.distance_squared_to(knob_slots[g])
		if d < bd:
			bd = d
			best = g
	_set_gear(best)

func _move_knob_to(g: String) -> void:
	knob_from = knob.position
	knob_to = knob_slots[g]
	knob_anim = 0.0

func _input(event: InputEvent) -> void:
	if not knob_dragging or gate == null:
		return
	if event is InputEventMouseMotion or event is InputEventScreenDrag:
		var lp: Vector2 = gate.get_local_mouse_position()
		knob.position = Vector2(clampf(lp.x - 22.0, 0.0, 136.0), clampf(lp.y - 22.0, 0.0, 106.0))

func _toast(s: String) -> void:
	if toast_label != null:
		toast_label.text = s
		toast_timer = 2.2

func _build_menus() -> void:
	menu_layer = CanvasLayer.new()
	menu_layer.layer = 10
	add_child(menu_layer)
	# main menu
	var menu := PanelContainer.new()
	menu.set_anchors_preset(Control.PRESET_CENTER)
	menu.position = Vector2(-220, -200)
	menu.size = Vector2(440, 400)
	menu_layer.add_child(menu)
	var v := VBoxContainer.new()
	menu.add_child(v)
	var title := Label.new()
	title.text = "АВТОДРОМ — Кызылорда"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 28)
	v.add_child(title)
	var sub := Label.new()
	sub.text = "Godot 4.7 · автомобиль + подготовительные задания"
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sub)
	var b_free := Button.new()
	b_free.text = "🏁 Гонка — город + кольцо (3 круга)"
	b_free.pressed.connect(_choose_mode.bind(true))
	v.add_child(b_free)
	var b_exam := Button.new()
	b_exam.text = "🎓 Экзамен — полигон (13 заданий)"
	b_exam.pressed.connect(_choose_mode.bind(false))
	v.add_child(b_exam)
	# prep overlay on its own layer (must stay visible after menu hides)
	prep_layer = CanvasLayer.new()
	prep_layer.layer = 11
	prep_layer.visible = false
	add_child(prep_layer)
	prep_overlay = PanelContainer.new()
	prep_overlay.set_anchors_preset(Control.PRESET_CENTER)
	prep_overlay.position = Vector2(-180, -240)
	prep_overlay.size = Vector2(360, 480)
	prep_layer.add_child(prep_overlay)
	var pv := VBoxContainer.new()
	prep_overlay.add_child(pv)
	var pt := Label.new()
	pt.text = "Пред-ездовая подготовка  (+5с за пропуск, макс +20с)"
	pv.add_child(pt)
	var names: Array[String] = ["Ремень пристёгнут", "Зеркала настроены", "Фары включены", "Ручник отпущен", "Передача — нейтраль", "Стекло очищено"]
	prep_boxes.clear()
	for n in names:
		var c := CheckBox.new()
		c.text = n
		pv.add_child(c)
		prep_boxes.append(c)
	var start := Button.new()
	start.text = "🏁 Стартую"
	start.pressed.connect(func() -> void: _start_race(false))
	pv.add_child(start)
	var skip := Button.new()
	skip.text = "Быстрый старт без подготовки"
	skip.pressed.connect(func() -> void: _start_race(true))
	pv.add_child(skip)
	# finish overlay
	finish_overlay = PanelContainer.new()
	finish_overlay.set_anchors_preset(Control.PRESET_CENTER)
	finish_overlay.position = Vector2(-210, -140)
	finish_overlay.size = Vector2(420, 280)
	finish_overlay.visible = false
	prep_layer.add_child(finish_overlay)
	finish_text = Label.new()
	finish_overlay.add_child(finish_text)

func _choose_mode(is_free: bool) -> void:
	free_mode = is_free
	(menu_layer.get_child(0) as Control).hide()
	prep_layer.visible = true
	prep_overlay.visible = true
	_spawn_at_start()

func _start_race(skip: bool) -> void:
	var skipped := 0
	for c in prep_boxes:
		if not c.button_pressed:
			skipped += 1
	var p := mini(20, skipped * 5)
	pen_time += float(p)
	penalties.append({"sec": p, "label": "подготовка"})
	prep_overlay.visible = false
	prep_layer.visible = false
	menu_layer.visible = false
	_spawn_at_start()
	_set_gear("N")
	mode = "race"
	race_t = 0.0
	lap = 1
	sector = 0.0
	expr_idx = 0
	_refresh_hud()
	_toast("Тяни кулису на 1 и жми ГО")

func _refresh_hud() -> void:
	if hud_expr != null:
		if free_mode:
			hud_expr.text = ""
		elif expr_idx < EXERCISES.size():
			hud_expr.text = "Задание %d/13: %s" % [expr_idx + 1, EXERCISES[expr_idx]]

func _finish_race() -> void:
	mode = "finish"
	if finish_overlay != null:
		prep_layer.visible = true
		finish_overlay.visible = true
		finish_text.text = "🏁 Финиш!\nЧистое: %s\nШтрафы: +%dс\nИтого: %s\n\n%s" % [_fmt(race_t), int(pen_time), _fmt(race_t + pen_time), _pen_lines()]

func _fmt(t: float) -> String:
	var m := int(t) / 60
	var s := t - float(m * 60)
	return "%d:%05.2f" % [m, s]

func _pen_lines() -> String:
	if penalties.is_empty():
		return "—"
	var s := ""
	for p in penalties:
		s += "• %s +%dс\n" % [str(p["label"]), int(p["sec"])]
	return s

func _add_penalty(sec: int, label: String) -> void:
	pen_time += float(sec)
	penalties.append({"sec": sec, "label": label})
	_toast("⚠ %s +%dс" % [label, sec])
	if hud_pen != null:
		hud_pen.text = "+штраф %dс" % int(pen_time)

# ---------- main loop ----------
func _physics_process(delta: float) -> void:
	if cone_cool > 0.0:
		cone_cool -= delta
	if mode != "race" or car == null:
		return
	race_t += delta
	var steer := 0.0
	var steer_min := Input.get_axis("steer_left", "steer_right")
	if absf(touch_steer) > 0.01:
		steer = touch_steer
	else:
		steer = steer_min
	steer = clampf(steer, -1.0, 1.0)
	var spd := car.linear_velocity.length()
	var steer_max := 0.55 / (1.0 + spd * 0.02)
	car.steering = steer * steer_max
	var cap: float = GEARS.get(gear, 0.0)
	if gear == "R":
		car.engine_force = -3200.0 if (Input.is_action_pressed("throttle") or touch_gas) else 0.0
		car.brake = 4000.0 if (Input.is_action_pressed("brake") or touch_brake) else 0.0
	elif gear == "N":
		car.engine_force = 0.0
		car.brake = 4000.0 if (Input.is_action_pressed("brake") or touch_brake) else 0.0
	else:
		var th := 1.0 if (Input.is_action_pressed("throttle") or touch_gas) else 0.0
		var k := clampf(1.0 - (spd - cap * 0.7) / maxf(cap * 0.3, 1.0), 0.0, 1.0)
		car.engine_force = 6500.0 * th * k
		car.brake = 6000.0 if (Input.is_action_pressed("brake") or touch_brake) else 0.0
	car.brake += 5000.0 if (Input.is_action_pressed("handbrake") or touch_hand) else 0.0
	if free_mode:
		var np := _nearest_on_ring(car.global_position)
		var prog := float(np["i"]) / float(ring.size())
		if prog < 0.08 and sector > 0.7 and float(np["d"]) < 16.0:
			if lap >= TOTAL_LAPS:
				_finish_race()
			else:
				lap += 1
				sector = 0.0
		else:
			sector = prog
		var kmh := car.linear_velocity.length() * 3.6
		var in_city := car.global_position.x < 300.0 and car.global_position.z > -380.0 and car.global_position.z < 240.0
		if in_city and kmh > 40.0:
			speed_zone_t += delta
			if speed_zone_t > 3.0:
				_add_penalty(10, "превышение 40")
				speed_zone_t = 0.0
		else:
			speed_zone_t = maxf(0.0, speed_zone_t - delta)
	if hud_speed != null:
		var kmh2 := car.linear_velocity.length() * 3.6
		hud_speed.text = "Скорость %d км/ч" % int(kmh2)
		hud_lap.text = "Круг %d/%d" % [mini(lap, TOTAL_LAPS), TOTAL_LAPS]
		hud_time.text = _fmt(race_t)
	if toast_timer > 0.0:
		toast_timer -= delta
		if toast_timer <= 0.0 and toast_label != null:
			toast_label.text = ""

func _process(delta: float) -> void:
	if wheel != null and not wheel_drag:
		wheel.steer = move_toward(wheel.steer, Input.get_axis("steer_left", "steer_right"), delta * 6.0)
		if wheel.steer != touch_steer and absf(touch_steer) < 0.01:
			touch_steer = wheel.steer
	if knob != null and knob_anim < 1.0:
		knob_anim = minf(1.0, knob_anim + delta / 0.12)
		knob.position = knob_from.lerp(knob_to, knob_anim)
	_update_camera(delta)
