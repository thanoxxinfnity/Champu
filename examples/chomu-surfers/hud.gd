extends CanvasLayer
## Score, coins, the zone banner, and the only screen the player sees when they
## lose.

@onready var _score: Label = $Score
@onready var _coins: Label = $Coins
@onready var _zone: Label = $Zone
@onready var _over: Control = $GameOver
@onready var _final: Label = $GameOver/Panel/Final

var _player: Node
var _banner: float = 0.0


func _ready() -> void:
	_over.hide()
	_zone.modulate.a = 0.0
	_player = get_parent().get_node_or_null("Player")
	if _player != null:
		_player.died.connect(_on_died)
		_player.picked_up.connect(_on_picked_up)
	get_parent().zone_changed.connect(_on_zone)


func _process(delta: float) -> void:
	if _player != null and _player.alive:
		_score.text = "%d m" % int(_player.distance)

	# The banner announces the zone and then gets out of the way; leaving it up
	# would cover the track the player needs to be reading.
	if _banner > 0.0:
		_banner = maxf(_banner - delta, 0.0)
		_zone.modulate.a = clampf(_banner, 0.0, 1.0)


func _on_zone(index: int, name: String) -> void:
	_zone.text = "STAGE %d — %s" % [index + 1, name.to_upper()]
	_banner = 2.6


func _on_picked_up(total: int) -> void:
	_coins.text = "● %d" % total


func _on_died(score: int, coins: int) -> void:
	_final.text = "%d points\n%d coins" % [score, coins]
	_over.show()


func _on_retry_pressed() -> void:
	get_tree().reload_current_scene()
