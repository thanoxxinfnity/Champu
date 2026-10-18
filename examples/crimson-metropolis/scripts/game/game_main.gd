extends Node
## The playable scene: builds the World and applies the mode chosen on the loading screen.


func _ready() -> void:
	var world := World.new()
	world.name = "World"
	add_child(world)
	await get_tree().process_frame
	var d := world.director
	if GameBoot.mode == GameBoot.Mode.FREE_ROAM:
		d.state.mission_stage = PenthouseDeal.Stage.DONE        # no story prompts; the city is yours
		d.hud.toast("Free Roam — the whole city is yours.", 4.0)
	else:
		if GameBoot.continue_save:
			d.state.load_save()
			d.apply_outfit()
		if d.state.mission_stage == PenthouseDeal.Stage.IDLE:
			d.hud.toast("Press ↑ for your phone — Vance has a job for you.", 5.0)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
