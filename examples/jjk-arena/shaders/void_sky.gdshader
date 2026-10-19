shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, fog_disabled;
#include "res://shaders/void_common.gdshaderinc"

uniform float reveal : hint_range(0.0, 1.0) = 1.0;

void fragment() {
	// the sphere is centred on the arena, so the local position is the direction
	vec3 dir = normalize((INV_VIEW_MATRIX * vec4(VERTEX, 0.0)).xyz);
	ALBEDO = void_color(dir, TIME) * reveal;
}
