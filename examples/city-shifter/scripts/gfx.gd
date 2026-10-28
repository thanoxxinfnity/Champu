class_name Gfx
extends RefCounted
## The graphics setting (Settings → GRAPHICS), named like Free Fire's: SMOOTH for old phones, STANDARD, ULTRA for strong ones.
## Everything here is what GL Compatibility can do on a phone: MSAA edges, a colour grade and soft blob shadows under the heroes. View distance is not part of it: everybody sees 50 m (the same for all players).

const NAMES := ["SMOOTH", "STANDARD", "ULTRA"]


static func apply(vp: Viewport, world: Node, level: int) -> void:
	level = clampi(level, 0, 2)
	if vp != null:
		vp.msaa_3d = [Viewport.MSAA_DISABLED, Viewport.MSAA_2X, Viewport.MSAA_4X][level]
		vp.scaling_3d_scale = [0.85, 1.0, 1.0][level]
	if DisplayServer.get_name() == "headless":
		return
	if world == null:
		return
	var env: Environment = world.get("_env") if world.get("_env") != null else world.get("env")
	if env != null:
		env.glow_enabled = false                # glow washed the bright anime greens into haze: crisp edges read better on a phone
		env.adjustment_enabled = level >= 1
		env.adjustment_brightness = 0.97
		env.adjustment_contrast = 1.1
		env.adjustment_saturation = 1.12 if level == 2 else 1.08
	# No real sun shadow: in GL Compatibility a shadowed directional light is drawn in an extra additive pass that adds the fog a
	# second time, which bleached the whole map white. Heroes get a soft blob shadow instead (Avatar), as most mobile shooters do.
	var sun: DirectionalLight3D = world.get("sun")
	if sun != null:
		sun.shadow_enabled = false


## A soft round shadow on the ground under a hero: one quad with a radial falloff, unshaded, no depth write.
static func blob(radius: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(radius * 2.0, radius * 2.0)
	qm.orientation = PlaneMesh.FACE_Y
	mi.mesh = qm
	var sm := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = """shader_type spatial;
render_mode unshaded, depth_draw_never, cull_disabled, shadows_disabled;
void fragment() {
	float d = length(UV - vec2(0.5)) * 2.0;
	ALBEDO = vec3(0.05, 0.07, 0.12);
	ALPHA = (1.0 - smoothstep(0.35, 1.0, d)) * 0.42;
}"""
	sm.shader = sh
	sm.render_priority = -1
	mi.material_override = sm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position.y = 0.03
	return mi
