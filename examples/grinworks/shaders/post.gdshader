shader_type canvas_item;

// Full-screen horror grade: vignette, a pulse of red when hurt, film grain.
uniform float hurt = 0.0;
uniform float low_hp = 0.0;
uniform float vignette = 0.55;
uniform float grain = 0.05;
uniform float flash = 0.0;

float h(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 uv = UV - 0.5;
	float d = dot(uv, uv) * 2.0;
	float v = smoothstep(0.15, 1.0, d) * (vignette + low_hp * 0.35);
	vec3 col = vec3(0.0);
	float a = v * 0.85;
	col = mix(col, vec3(0.45, 0.0, 0.0), clamp(hurt + low_hp * 0.35 * smoothstep(0.2, 1.0, d), 0.0, 1.0));
	a = max(a, hurt * smoothstep(0.0, 1.0, d) * 0.9 + low_hp * 0.18 * smoothstep(0.2, 1.0, d));
	float g = (h(UV * 640.0 + fract(TIME) * 100.0) - 0.5) * grain;
	col += g;
	a += abs(g) * 0.6;
	// Lightning flash lifts the whole frame.
	col = mix(col, vec3(0.75, 0.82, 1.0), flash);
	a = max(a, flash * 0.35);
	COLOR = vec4(col, clamp(a, 0.0, 1.0));
}
