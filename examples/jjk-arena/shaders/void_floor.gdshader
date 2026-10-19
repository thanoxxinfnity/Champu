shader_type spatial;
render_mode unshaded, cull_back, fog_disabled;
#include "res://shaders/void_common.gdshaderinc"

uniform float gloss : hint_range(0.0, 1.0) = 1.0;       // 1 = perfect mirror
uniform float tint_dark : hint_range(0.0, 1.0) = 0.12;  // glossy black base
uniform float reveal : hint_range(0.0, 1.0) = 1.0;

void fragment() {
	// Compatibility has no screen-space reflections, so the floor reflects the sky analytically: same function, mirrored view vector.
	vec3 view_world = normalize((INV_VIEW_MATRIX * vec4(VIEW, 0.0)).xyz);   // from the surface towards the camera
	vec3 n = vec3(0.0, 1.0, 0.0);
	vec3 r = reflect(-view_world, n);
	float fres = 0.55 + 0.45 * pow(1.0 - clamp(dot(view_world, n), 0.0, 1.0), 3.0);
	vec3 refl = void_color(normalize(vec3(r.x, abs(r.y), r.z)), TIME);
	vec3 col = mix(vec3(tint_dark * 0.05), refl, gloss * fres);
	ALBEDO = col * reveal;
}
