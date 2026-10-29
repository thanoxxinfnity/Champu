extends SceneTree
## Draw calls, objects and triangles of the open world as the player sees it at the start. CS_NO_HOUSES=1 leaves the houses out for comparison.
##   xvfb-run -a godot --rendering-driver opengl3 --path . -s tests/perf_probe.gd
func _initialize() -> void:
	root.size = Vector2i(960, 540)
	var g := await T.boot(self, "viper")
	g.mode = "world"
	g.match_type = "solo"
	g.start_play()
	await T.frames(self, 40)
	var t0 := Time.get_ticks_msec()
	await T.frames(self, 20)
	var ms := float(Time.get_ticks_msec() - t0) / 20.0
	print("PERF draw_calls=", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		" objects=", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
		" tris=", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME), " ms/frame=", ms)
	quit()
