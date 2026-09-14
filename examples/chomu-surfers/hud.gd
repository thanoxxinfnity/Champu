extends CanvasLayer
## Score, coins, and the only screen the player sees when they lose.

@onready var _score: Label = $Score
@onready var _coins: Label = $Coins
@onready var _over: Control = $GameOver
@onready var _final: Label = $GameOver/Panel/Final

var _player: Node


func _ready() -> void:
	_over.hide()
	_player = get_parent().get_node_or_null("Player")
	if _player != null:
		_player.died.connect(_on_died)
		_player.picked_up.connect(_on_picked_up)


func _process(_delta: float) -> void:
	if _player != null and _player.alive:
		_score.text = "%d m" % int(_player.distance)


func _on_picked_up(total: int) -> void:
	_coins.text = "● %d" % total


func _on_died(score: int, coins: int) -> void:
	_final.text = "%d points\n%d coins" % [score, coins]
	_over.show()


func _on_retry_pressed() -> void:
	get_tree().reload_current_scene()
