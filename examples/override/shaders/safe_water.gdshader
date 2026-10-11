shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never;

// A safe station seen from above: a pool of clean water with slow ripples, and a thin green ring on the floor where the water's spray
// reaches (the creatures will not cross it). Drawn on one flat quad, so it costs one draw call.
uniform float pool_r = 2.3;       // the water, in metres
uniform float ring_r = 5.0;       // the ring, in metres
uniform float quad_size = 10.4;   // the quad's side, in metres

void fragment() {
	vec2 p = (UV - 0.5) * quad_size;
	float d = length(p);
	vec3 col = vec3(0.0);
	float a = 0.0;
	if (d < pool_r) {
		float rip = sin(d * 7.0 - TIME * 1.6) * 0.5 + 0.5;
		float rip2 = sin(d * 13.0 + TIME * 1.1 + p.x * 1.7) * 0.5 + 0.5;
		col = mix(vec3(0.08, 0.25, 0.42), vec3(0.35, 0.7, 0.95), rip * 0.35 + rip2 * 0.2);
		a = 0.62;
		a *= smoothstep(pool_r, pool_r - 0.15, d) * 0.7 + 0.3;
	}
	float ring = smoothstep(0.06, 0.0, abs(d - ring_r + 0.1));
	float dash = step(0.5, fract(atan(p.y, p.x) * 8.0 / 6.2831 + TIME * 0.05));
	col = mix(col, vec3(0.2, 1.0, 0.45), ring * (0.35 + 0.35 * dash));
	a = max(a, ring * (0.25 + 0.3 * dash));
	if (a < 0.01) discard;
	ALBEDO = col;
	ALPHA = a;
}
