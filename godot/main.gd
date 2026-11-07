extends Node3D
# Avtodrom 3D — Godot 4.7 + Jolt. Kyzylorda stylised map, VehicleBody3D car, touch UI.
# Port of the Three.js MVP: wheel/pedals/lever/H-gear, checklist + penalties, 3 laps.

const TOTAL_LAPS := 3
const TOP_SPEED := 33.0
const GEARS := {"R": 8.0, "N": 0.0, "1": 14.0, "2": 22.0, "3": 29.0, "4": 36.0, "5": 42.0}
var gear: String = "N"

var car: VehicleBody3D
var chassis_mesh: Node3D
var cam: Camera3D
var mode: String = "menu" # menu | prep | race | finish
var lap := 1
var race_t := 0.0
var pen_time := 0.0
var sector := 0.0
var speed_zone_t := 0.0
var off_track_t := 0.0
var penalties: Array = []

var hud_speed: Label
var hud_lap: Label
var hud_time: Label
var hud_pen: Label
var hud_gear: Label
var toast_label: Label
var toast_timer := 0.0
var prep_overlay: Control
var finish_overlay: PanelContainer
var finish_text: Label

var ring: Array[Vector3] = []
var ring_n := 360

func _ready() -> void:
	if DisplayServer.get_name() == "headless":
		return
	_ensure_input_actions()
	_build_environment()
	_build_map()
	_build_car()
	_build_camera()
	_build_hud()
	_build_overlays()
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

# ---------- environment ----------
func _build_environment() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var mat := ProceduralSkyMaterial.new()
	sky.sky_material = mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.15
	env.fog_enabled = true
	env.fog_light_color = Color(0.53, 0.71, 0.84)
	env.fog_density = 0.0015
	env.volumetric_fog_enabled = false
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
	(get_parent() if parent == null else parent).add_child(b)
	return b

# ---------- map ----------
func _build_map() -> void:
	# ground + pads
	_box(Vector3(2400, 1, 1600), Vector3(0, -0.55, 0), Color(0.79, 0.69, 0.46))
	_box(Vector3(920, 0.6, 660), Vector3(-260, -0.3, -40), Color(0.56, 0.6, 0.5))
	_box(Vector3(620, 0.6, 520), Vector3(600, -0.3, -230), Color(0.33, 0.36, 0.39))
	# river
	_box(Vector3(150, 0.4, 2100), Vector3(-60, 0, 340), Color(0.18, 0.56, 0.71, 1.0), false).rotation_degrees.y = 25.7
	# avenues: horizontal + vertical roads
	_road(Vector2(-650, -80), Vector2(250, -80), 18.0)
	_road(Vector2(-180, -350), Vector2(-180, 220), 16.0)
	_road(Vector2(-380, -350), Vector2(-380, 220), 14.0)
	_road(Vector2(40, -320), Vector2(40, 180), 14.0)
	_road(Vector2(-650, 180), Vector2(250, 180), 22.0)
	_road(Vector2(-180, 180), Vector2(-180, 520), 16.0)
	_road(Vector2(-650, -300), Vector2(250, -300), 14.0)
	_road(Vector2(180, -350), Vector2(180, 220), 14.0)
	# bridges
	for bx in [-180.0, 40.0]:
		_box(Vector3(20, 2, 220), Vector3(bx, 1.0, 340), Color(0.33, 0.36, 0.39))
	# park + stadium
	_box(Vector3(150, 0.4, 110), Vector3(90, 0.1, -190), Color(0.25, 0.56, 0.25), false)
	_box(Vector3(70, 14, 48), Vector3(90, 7, -190), Color(0.85, 0.85, 0.85))
	# buildings in blocks along streets
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
	# trees: park cluster + avenue lines (cones)
	for i in range(56):
		var in_park := i < 40
		var x := 25.0 + float((i * 37) % 130) if in_park else -630.0 + float(i * 53 % 880)
		var z := -235.0 + float((i * 53) % 90) if in_park else (-68.0 if i % 2 == 0 else 192.0)
		var trunk := _box(Vector3(0.6, 2.0, 0.6), Vector3(x, 1.0, z), Color(0.4, 0.28, 0.18))
		trunk.use_collision = false
		var cone := MeshInstance3D.new()
		var cm := PrismMesh.new()
		cm.size = Vector3(4.5, 8.0, 4.5)
		cm.left_to_right = 0.5
		cone.mesh = cm
		cone.material_override = _mat(Color(0.18, 0.42, 0.18))
		cone.position = Vector3(x, 6.0, z)
		add_child(cone)
	# autodrom ring
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
	var N := ring_n
	for i in range(N):
		var t := float(i) / float(N)
		var p := curve.sample_baked(t * curve.get_baked_length())
		ring.append(p)
	# asphalt + white edge ribbon segments as low boxes with collision (track floor)
	for i in range(N):
		var p := ring[i]
		var q := ring[(i + 1) % N]
		var t := (q - p)
		var len := t.length()
		if len < 0.01:
			continue
		var yaw := rad_to_deg(atan2(t.x, t.z))
		var seg := _box(Vector3(18, 0.3, len + 0.5), Vector3((p.x + q.x) * 0.5, 0.05, (p.z + q.z) * 0.5), Color(0.23, 0.25, 0.28))
		seg.rotation_degrees.y = yaw
	# start gantry
	var p0: Vector3 = ring[0]
	_box(Vector3(24, 2.2, 2), Vector3(p0.x, 9, p0.z), Color(0.08, 0.1, 0.14))
	_box(Vector3(2, 9, 2), Vector3(p0.x - 11, 4.5, p0.z), Color(0.13, 0.16, 0.22))
	_box(Vector3(2, 9, 2), Vector3(p0.x + 11, 4.5, p0.z), Color(0.13, 0.16, 0.22))
	_box(Vector3(22, 2, 0.5), Vector3(p0.x, 9, p0.z + 1.2), Color(1.0, 0.79, 0.2), false)

func _nearest_on_ring(pos: Vector3) -> Dictionary:
	var best_d := 1e9
	var best_i := 0
	for i in range(ring.size()):
		var d := ring[i].distance_to(pos)
		if d < best_d:
			best_d = d
			best_i = i
	return {"d": best_d, "i": best_i, "p": ring[best_i]}

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
	# wheels FL FR RL RR (front = -Z of VehicleBody)
	_add_wheel(Vector3(-1.1, 0.45, 1.5), true)
	_add_wheel(Vector3(1.1, 0.45, 1.5), true)
	_add_wheel(Vector3(-1.1, 0.45, -1.5), false)
	_add_wheel(Vector3(1.1, 0.45, -1.5), false)
	# visual: try GLB, fallback box
	var glb: PackedScene = load("res://models/spectral_gt_rs.glb")
	if glb == null:
		glb = load("res://models/ferrari.glb")
	if glb != null:
		chassis_mesh = glb.instantiate() as Node3D
		chassis_mesh.rotation_degrees.y = 90.0
		chassis_mesh.scale = Vector3.ONE
		car.add_child(chassis_mesh)
	else:
		chassis_mesh = _box(Vector3(2.2, 0.7, 4.6), Vector3(0, 0.6, 0), Color(0.88, 0.19, 0.19), false, car)
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
	if ring.is_empty():
		return
	var p0: Vector3 = ring[0]
	var p1: Vector3 = ring[4]
	car.global_position = Vector3(p0.x, 1.2, p0.z)
	car.look_at(Vector3(p1.x, 1.2, p1.z), Vector3.UP)
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	car.engine_force = 0.0
	car.brake = 0.0
	car.steering = 0.0
	sector = 0.0

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
	toast_label = Label.new()
	toast_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.add_theme_font_size_override("font_size", 20)
	layer.add_child(toast_label)
	# touch buttons
	_btn(layer, "◀", Vector2(16, -180), 86, 86, _steer_set.bind(-1.0), _steer_clear.bind(-1.0))
	_btn(layer, "▶", Vector2(112, -180), 86, 86, _steer_set.bind(1.0), _steer_clear.bind(1.0))
	_btn(layer, "СТОП", Vector2(-190, -130), 80, 100, func() -> void: touch_brake = true, func() -> void: touch_brake = false)
	_btn(layer, "ГО", Vector2(-100, -140), 90, 120, func() -> void: touch_gas = true, func() -> void: touch_gas = false)
	_btn(layer, "РУЧНИК", Vector2(-100, -260), 90, 50, func() -> void: touch_hand = true, func() -> void: touch_hand = false)
	# gear strip
	var gr := HBoxContainer.new()
	gr.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	gr.position = Vector2(210, -120)
	layer.add_child(gr)
	for g in ["R", "N", "1", "2", "3", "4", "5"]:
		var b := Button.new()
		b.text = g
		b.custom_minimum_size = Vector2(46, 46)
		b.pressed.connect(_set_gear.bind(g))
		gr.add_child(b)

func _pill(parent: Node, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 16)
	l.add_theme_color_override("font_color", Color.WHITE)
	parent.add_child(l)
	return l

func _btn(parent: Node, text: String, pos: Vector2, w: float, h: float, down: Callable, up: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.position = pos
	b.custom_minimum_size = Vector2(w, h)
	b.size = Vector2(w, h)
	b.button_down.connect(down)
	b.button_up.connect(up)
	parent.add_child(b)
	return b

var touch_steer := 0.0
var touch_gas := false
var touch_brake := false
var touch_hand := false

func _steer_set(v: float) -> void:
	touch_steer = v

func _steer_clear(v: float) -> void:
	if touch_steer == v:
		touch_steer = 0.0

func _set_gear(g: String) -> void:
	gear = g
	if hud_gear != null:
		hud_gear.text = g

func _build_overlays() -> void:
	# prep checklist
	prep_overlay = PanelContainer.new()
	prep_overlay.set_anchors_preset(Control.PRESET_CENTER)
	prep_overlay.position = Vector2(-180, -240)
	prep_overlay.size = Vector2(360, 480)
	add_child(prep_overlay)
	var v := VBoxContainer.new()
	prep_overlay.add_child(v)
	var title := Label.new()
	title.text = "Пред-ездовая подготовка  (+5с за пропуск, макс +20с)"
	v.add_child(title)
	var names: Array[String] = ["Ремень пристёгнут", "Зеркала настроены", "Фары включены", "Ручник отпущен", "Передача — нейтраль", "Стекло очищено"]
	for n in names:
		var c := CheckBox.new()
		c.text = n
		v.add_child(c)
	var start := Button.new()
	start.text = "🏁 Стартую"
	start.pressed.connect(func() -> void: _start_race(false))
	v.add_child(start)
	var skip := Button.new()
	skip.text = "Быстрый старт без подготовки"
	skip.pressed.connect(func() -> void: _start_race(true))
	v.add_child(skip)

func _start_race(skip: bool) -> void:
	var skipped := 0
	for child in (prep_overlay.get_child(0) as VBoxContainer).get_children():
		if child is CheckBox and not (child as CheckBox).button_pressed:
			skipped += 1
	var p := mini(20, skipped * 5)
	pen_time += float(p)
	penalties.append({"sec": p, "label": "подготовка"})
	prep_overlay.visible = false
	_spawn_at_start()
	mode = "race"
	race_t = 0.0
	lap = 1
	sector = 0.0

func _finish_race() -> void:
	mode = "finish"
	if finish_overlay != null and finish_overlay.get_parent() != null:
		finish_overlay.queue_free()
	finish_overlay = PanelContainer.new()
	finish_overlay.set_anchors_preset(Control.PRESET_CENTER)
	finish_overlay.position = Vector2(-210, -140)
	finish_overlay.size = Vector2(420, 280)
	add_child(finish_overlay)
	finish_text = Label.new()
	finish_text.text = "🏁 Финиш!\nЧистое: %s\nШтрафы: +%dс\nИтого: %s\n\n%s" % [_fmt(race_t), int(pen_time), _fmt(race_t + pen_time), _pen_lines()]
	finish_overlay.add_child(finish_text)

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
	if toast_label != null:
		toast_label.text = "⚠ %s +%dс" % [label, sec]
		toast_timer = 2.2
	if hud_pen != null:
		hud_pen.text = "+штраф %dс" % int(pen_time)

# ---------- main loop ----------
func _physics_process(delta: float) -> void:
	if mode != "race" or car == null:
		return
	race_t += delta
	# steering from keyboard + touch
	var steer := Input.get_axis("steer_left", "steer_right")
	if absf(touch_steer) > 0.01:
		steer = touch_steer
	steer = clampf(steer, -1.0, 1.0)
	var spd := car.linear_velocity.length()
	var steer_max := 0.55 / (1.0 + spd * 0.02)
	car.steering = steer * steer_max
	# gear-limited throttle
	var cap: float = GEARS.get(gear, 0.0)
	if gear == "R":
		car.engine_force = -3200.0 if (Input.is_action_pressed("throttle") or touch_gas) else 0.0
		car.brake = 4000.0 if (Input.is_action_pressed("brake") or touch_brake) else 0.0
	elif gear == "N":
		car.engine_force = 0.0
		car.brake = 4000.0 if (Input.is_action_pressed("brake") or touch_brake) else 0.0
	else:
		var th := 1.0 if (Input.is_action_pressed("throttle") or touch_gas) else 0.0
		# simple gear cap: scale engine force down near cap speed
		var k := clampf(1.0 - (spd - cap * 0.7) / maxf(cap * 0.3, 1.0), 0.0, 1.0)
		car.engine_force = 6500.0 * th * k
		car.brake = 6000.0 if (Input.is_action_pressed("brake") or touch_brake) else 0.0
	car.brake += 5000.0 if (Input.is_action_pressed("handbrake") or touch_hand) else 0.0
	# lap / penalties
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
	if float(np["d"]) > 14.0:
		off_track_t += delta
		if off_track_t > 10.0:
			_add_penalty(5, "выезд за трассу")
			off_track_t = 0.0
	else:
		off_track_t = maxf(0.0, off_track_t - delta)
	# HUD
	if hud_speed != null:
		hud_speed.text = "Скорость %d км/ч" % int(kmh)
		hud_lap.text = "Круг %d/%d" % [mini(lap, TOTAL_LAPS), TOTAL_LAPS]
		hud_time.text = _fmt(race_t)
	if toast_timer > 0.0:
		toast_timer -= delta
		if toast_timer <= 0.0 and toast_label != null:
			toast_label.text = ""

func _process(delta: float) -> void:
	_update_camera(delta)
