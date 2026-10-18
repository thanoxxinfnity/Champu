class_name Atmosphere
extends Node3D
## The sky, the sun and moon, the fog, the weather and the clock. One real minute is one in-game hour.
## It drives everything that changes with time: the sun's angle and colour, the procedural sky, fog density, the
## `night` shader global (lit windows), the street lamps and headlights (by group), rain, and wet roads.

signal hour_changed(hour: float)
signal weather_changed(weather: StringName)

const WEATHERS: Array[StringName] = [&"clear", &"haze", &"rain"]
const SUNSET_HOUR := 19.0
const LAMPS_ON_NIGHT := 0.5     # lamps and headlights come on once the night factor passes this

var hour := 9.0
var weather: StringName = &"clear"
var clock_running := true
var night_amount := 0.0         # 0 = full day, 1 = full night
var rain_amount := 0.0          # eased toward the weather's target
var haze_amount := 0.0
var follow: Node3D              # the rain falls around this node (the player's camera)

var sun: DirectionalLight3D
var env: Environment
var sky_mat: ProceduralSkyMaterial
var _rain: GPUParticles3D
var _wet_mats: Array[StandardMaterial3D] = []
var _lamps_on := false
var _last_whole_hour := -1


func _ready() -> void:
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 140.0
	sun.directional_shadow_blend_splits = true
	sun.shadow_bias = 0.04
	add_child(sun)

	sky_mat = ProceduralSkyMaterial.new()
	sky_mat.sun_angle_max = 25.0
	sky_mat.sun_curve = 0.12
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_white = 6.0
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.04
	env.fog_enabled = true
	env.fog_sky_affect = 0.4
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.08
	env.adjustment_contrast = 1.06
	var we := WorldEnvironment.new()
	we.name = "WorldEnvironment"
	we.environment = env
	add_child(we)

	_rain = _make_rain()
	add_child(_rain)
	_apply(1.0)


func _process(delta: float) -> void:
	if clock_running:
		advance(delta * Data.GAME_HOURS_PER_REAL_SECOND)
	_apply(delta)
	if follow != null and is_instance_valid(follow):
		_rain.global_position = follow.global_position + Vector3(0, 14, 0)


## Move the clock forward by `hours` (also used by the bed: sleeping advances eight).
func advance(hours: float) -> void:
	hour = fposmod(hour + hours, 24.0)
	var whole := int(floor(hour))
	if whole != _last_whole_hour:
		_last_whole_hour = whole
		hour_changed.emit(hour)


func set_hour(h: float) -> void:
	hour = fposmod(h, 24.0)
	_last_whole_hour = int(floor(hour))
	hour_changed.emit(hour)
	_apply(1.0)


func set_weather(w: StringName) -> void:
	if w == weather or not WEATHERS.has(w):
		return
	weather = w
	weather_changed.emit(w)


func register_wet_material(m: StandardMaterial3D) -> void:
	_wet_mats.append(m)


## Degrees C for the phone's widget: cooler at night and in the rain.
func temperature() -> float:
	var daily := 18.0 + 8.0 * sin((hour - 9.0) / 24.0 * TAU)
	return daily - rain_amount * 4.0 + haze_amount * 2.0


func clock_text() -> String:
	var h := int(floor(hour))
	var m := int(floor((hour - h) * 60.0))
	return "%02d:%02d" % [h, m]


func is_night() -> bool:
	return night_amount > LAMPS_ON_NIGHT


# ── per-frame state ───────────────────────────────────────────────────────────

func _apply(delta: float) -> void:
	var k := 1.0 if delta >= 1.0 else 1.0 - exp(-0.8 * delta)
	rain_amount = lerpf(rain_amount, 1.0 if weather == &"rain" else 0.0, k)
	haze_amount = lerpf(haze_amount, 1.0 if weather == &"haze" else 0.0, k)

	# Signed sun height: +1 at noon, 0 at 06:00 and 18:00, -1 at midnight. Everything blends off this one number, so dusk
	# and dawn are gradual instead of a switch at the horizon.
	var s := sin((hour - 6.0) / 24.0 * TAU)
	var elev := clampf(s, 0.0, 1.0)
	var sun_up := s > -0.04
	night_amount = smoothstep(0.1, -0.3, s)
	RenderingServer.global_shader_parameter_set("night", night_amount)

	var day_phase := fposmod(hour - 6.0, 24.0) / 12.0           # 0..1 while the sun is up
	var azimuth := lerpf(-70.0, 70.0, clampf(day_phase, 0.0, 1.0))
	var warm := Color(1.0, 0.93, 0.8).lerp(Color(1.0, 0.55, 0.28), smoothstep(0.45, 0.0, elev))
	var overcast := clampf(rain_amount * 0.8 + haze_amount * 0.3, 0.0, 1.0)
	if sun_up:
		sun.rotation = Vector3(-deg_to_rad(4.0 + elev * 63.0), deg_to_rad(azimuth), 0.0)
		sun.light_color = warm.lerp(Color(0.82, 0.86, 0.92), overcast)
		sun.light_energy = lerpf(0.0, 1.35, smoothstep(0.0, 0.3, s)) * (1.0 - overcast * 0.65)
	else:
		# The moon: dim and blue, rising as the sun sets.
		var moon_elev := clampf(-s, 0.0, 1.0)
		var night_phase := fposmod(hour - 18.0, 24.0) / 12.0
		sun.rotation = Vector3(-deg_to_rad(8.0 + moon_elev * 50.0), deg_to_rad(lerpf(70.0, -70.0, clampf(night_phase, 0.0, 1.0))), 0.0)
		sun.light_color = Color(0.55, 0.65, 0.95)
		sun.light_energy = 0.22 * smoothstep(0.0, 0.25, moon_elev) * (1.0 - overcast * 0.5)
	sun.shadow_enabled = sun.light_energy > 0.05

	var day_top := Color(0.22, 0.42, 0.78)
	var day_hz := Color(0.66, 0.77, 0.9)
	var set_hz := Color(0.98, 0.6, 0.38)
	var night_top := Color(0.03, 0.05, 0.13)
	var night_hz := Color(0.09, 0.12, 0.22)
	var sunset := smoothstep(0.5, 0.0, s) * (1.0 - night_amount)
	var top := day_top.lerp(night_top, night_amount)
	var hz := day_hz.lerp(set_hz, sunset).lerp(night_hz, night_amount)
	var grey := Color(0.5, 0.53, 0.57) * lerpf(1.0, 0.25, night_amount)
	top = top.lerp(grey, overcast)
	hz = hz.lerp(grey.lightened(0.1), overcast)
	hz = hz.lerp(Color(0.85, 0.72, 0.55) * lerpf(1.0, 0.3, night_amount), haze_amount * 0.55)
	sky_mat.sky_top_color = top
	sky_mat.sky_horizon_color = hz
	sky_mat.ground_horizon_color = hz.darkened(0.1)
	sky_mat.ground_bottom_color = hz.darkened(0.45)
	sky_mat.sky_energy_multiplier = lerpf(1.0, 0.7, night_amount)

	env.ambient_light_energy = lerpf(1.0, 0.32, night_amount)
	env.fog_light_color = hz
	env.fog_density = 0.0006 + rain_amount * 0.0035 + haze_amount * 0.0014 + night_amount * 0.0004
	env.glow_intensity = lerpf(0.4, 0.9, night_amount)

	_rain.emitting = rain_amount > 0.05
	_rain.amount_ratio = clampf(rain_amount, 0.05, 1.0)
	for m in _wet_mats:
		m.roughness = lerpf(0.92, 0.22, rain_amount)
		m.metallic_specular = lerpf(0.4, 0.9, rain_amount)

	var want_lamps := night_amount > LAMPS_ON_NIGHT
	if want_lamps != _lamps_on:
		_lamps_on = want_lamps
		get_tree().call_group("streetlight", "set_lit", want_lamps)
		get_tree().call_group("headlights", "set_lit", want_lamps)


func lamps_are_on() -> bool:
	return _lamps_on


func _make_rain() -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.name = "Rain"
	p.amount = 1400
	p.lifetime = 0.9
	p.visibility_aabb = AABB(Vector3(-30, -20, -30), Vector3(60, 30, 60))
	p.emitting = false
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(26, 0.5, 26)
	pm.direction = Vector3(0.12, -1, 0)
	pm.spread = 2.0
	pm.initial_velocity_min = 24.0
	pm.initial_velocity_max = 30.0
	pm.gravity = Vector3(0, -10, 0)
	p.process_material = pm
	var quad := QuadMesh.new()
	quad.size = Vector2(0.018, 0.55)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(0.75, 0.82, 0.95, 0.35)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.billboard_keep_scale = true
	quad.material = mat
	p.draw_pass_1 = quad
	return p
