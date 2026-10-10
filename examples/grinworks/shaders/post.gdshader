shader_type canvas_item;

// Full-screen horror grade: vignette, a pulse of red when hurt, film grain.
uniform float hurt = 0.0;
uniform float low_hp = 0.0;
uniform float vignette = 0.55;
uniform float grain = 0.05;
uniform float flash = 0.0;
uniform float dread = 0.0;     // 0..1 tension: the picture gets dirtier, darker at the edges
uniform float beat = 0.0;      // 0..1 a heartbeat pulse

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
	// Tension: edges close in and throb with the pulse, and the grain gets coarser.
	a = max(a, smoothstep(0.1, 1.0, d) * (dread * 0.55 + beat * 0.25));
	col = mix(col, vec3(0.08, 0.0, 0.0), beat * 0.3 * smoothstep(0.3, 1.0, d));
	float g = (h(floor(UV * mix(640.0, 320.0, dread)) + fract(TIME) * 100.0) - 0.5) * (grain + dread * 0.12);
	col += g;
	a += abs(g) * 0.6;
	// Lightning flash lifts the whole frame.
	col = mix(col, vec3(0.75, 0.82, 1.0), flash);
	a = max(a, flash * 0.35);
	COLOR = vec4(col, clamp(a, 0.0, 1.0));
}
