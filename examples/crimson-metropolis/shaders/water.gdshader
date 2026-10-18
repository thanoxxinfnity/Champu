shader_type spatial;
render_mode cull_disabled;
// The sea: two scrolling noise normals, a fresnel mix of deep colour and sky, a white fringe where it meets the shore.

uniform vec3 deep : source_color = vec3(0.02, 0.18, 0.28);
uniform vec3 shallow : source_color = vec3(0.1, 0.5, 0.55);
uniform sampler2D wave_n : hint_normal, repeat_enable, filter_linear_mipmap;
uniform float radial_radius = 0.0;   // > 0: the shore is a circle of this radius (an island); 0: the shore is the line z = 440
global uniform float night;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	VERTEX.y += sin(wpos.x * 0.11 + TIME * 0.9) * 0.12 + sin(wpos.z * 0.17 + TIME * 0.7) * 0.1;
}

void fragment() {
	vec2 uv1 = wpos.xz * 0.045 + vec2(TIME * 0.012, TIME * 0.007);
	vec2 uv2 = wpos.xz * 0.11 - vec2(TIME * 0.02, -TIME * 0.011);
	NORMAL_MAP = mix(texture(wave_n, uv1).rgb, texture(wave_n, uv2).rgb, 0.5);
	NORMAL_MAP_DEPTH = 0.9;
	float shore = radial_radius > 0.0 ? clamp((length(wpos.xz) - radial_radius) / 220.0, 0.0, 1.0) : clamp((wpos.z - 440.0) / 60.0, 0.0, 1.0);
	vec3 col = mix(shallow, deep, shore);
	float f = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), 3.0);
	ALBEDO = col * mix(1.0, 0.25, night);
	ROUGHNESS = 0.08;
	METALLIC = 0.2;
	SPECULAR = 0.9;
	EMISSION = vec3(0.35, 0.55, 0.7) * f * mix(0.5, 0.08, night);
	// A bright fringe of foam along the waterline.
	float foam = smoothstep(0.08, 0.0, shore) * (0.6 + 0.4 * sin(wpos.x * 0.4 + TIME * 1.5));
	ALBEDO = mix(ALBEDO, vec3(0.92), foam * 0.6);
}
