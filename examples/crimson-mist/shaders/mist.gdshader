shader_type spatial;
// Fog sheet: a large translucent quad of drifting noise, crimson at the edges. Stacked at a few heights over streets and the harbour.
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

uniform vec4 tint : source_color = vec4(0.85, 0.28, 0.34, 1.0);
uniform float density = 0.18;
uniform float speed = 0.015;
uniform float scale = 0.035;

varying vec3 wpos;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz * scale + vec2(TIME * speed, TIME * speed * 0.6);
	float n = vnoise(p) * 0.55 + vnoise(p * 2.3 + 7.0) * 0.3 + vnoise(p * 5.1) * 0.15;
	float edge = smoothstep(0.0, 0.3, UV.x) * smoothstep(1.0, 0.7, UV.x) * smoothstep(0.0, 0.3, UV.y) * smoothstep(1.0, 0.7, UV.y);
	ALBEDO = tint.rgb;
	ALPHA = clamp((n - 0.28) * 1.8, 0.0, 1.0) * density * edge;
}
