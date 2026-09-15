extends Node3D
## Wires the player to the world: what it hits, what it picks up, and which
## zone it is in.
##
## Detection lives here rather than on each obstacle so there is one rule for
## the whole game — a hundred Area3Ds each deciding what a collision means is
## how two of them end up disagreeing. Zone progression lives here for the same
## reason: one place decides what "level 3" means to the track, the sky and the
## music at once, so they cannot drift apart.

signal zone_changed(index: int, name: String)

@onready var _player: CharacterBody3D = $Player
@onready var _track: Node3D = $Track
@onready var _env: WorldEnvironment = $WorldEnvironment
@onready var _zones: Node = $Zones
@onready var _audio: Node = $Audio
@onready var _voice: Node = $Voice

var _zone_index: int = -1
## Colours are eased rather than snapped, so a zone change reads as travelling
## into somewhere rather than as a scene reload.
var _blend: float = 1.0
var _from: RefCounted
var _to: RefCounted


func _ready() -> void:
	var hitbox: Area3D = $Player/Hitbox
	hitbox.area_entered.connect(_on_touched)
	_player.died.connect(_on_died)
	_apply_zone(0, true)
	_voice.say("intro")


func _on_touched(area: Area3D) -> void:
	if not _player.alive:
		return
	if area.is_in_group("coin"):
		_player.collect()
		_audio.play("coin")
		# Hidden rather than freed: it belongs to a recycled segment, and
		# freeing it would leave a hole the next time that segment comes round.
		area.hide()
		area.set_deferred("monitorable", false)
	elif area.is_in_group("hazard"):
		_player.crash()
		_audio.play("crash")


func _process(delta: float) -> void:
	if _player.alive:
		var found: Array = _zones.at_distance(_player.distance)
		if found[0] != _zone_index:
			_apply_zone(found[0], false)

	if _blend < 1.0:
		_blend = minf(_blend + delta * 0.6, 1.0)
		_paint(_blend)


func _apply_zone(index: int, immediate: bool) -> void:
	var found: Array = _zones.at_distance(_zones.zones[index].from)
	_from = _to if _to != null else found[1]
	_to = found[1]
	_zone_index = index

	_track.obstacle_chance = _to.obstacle_chance
	_track.coin_chance = _to.coin_chance
	_player.max_speed = _to.speed_cap

	_audio.play_zone(index)
	if not immediate:
		_audio.play("levelup")
		# After the chime, not over it — two sounds at once is one sound nobody
		# can make out.
		await get_tree().create_timer(0.7).timeout
		_voice.say("stage")
	zone_changed.emit(index, _to.name)

	_blend = 1.0 if immediate else 0.0
	_paint(1.0 if immediate else 0.0)


func _paint(t: float) -> void:
	var env: Environment = _env.environment
	var sky: ProceduralSkyMaterial = (env.sky.sky_material as ProceduralSkyMaterial)
	sky.sky_top_color = _from.sky_top.lerp(_to.sky_top, t)
	sky.sky_horizon_color = _from.sky_horizon.lerp(_to.sky_horizon, t)
	sky.ground_horizon_color = _from.sky_horizon.lerp(_to.sky_horizon, t)
	env.fog_light_color = _from.fog.lerp(_to.fog, t)
	env.fog_density = lerpf(_from.fog_density, _to.fog_density, t)
	_track.repaint(_from.ground.lerp(_to.ground, t), _from.rail.lerp(_to.rail, t), _zone_index)


func _on_died(_score: int, _coins: int) -> void:
	# Interrupts: the run is over, so whatever was being said no longer applies.
	_voice.say("gameover", true)
