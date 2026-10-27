shader_type spatial;
render_mode diffuse_toon, specular_toon;
// Anime downtown: pastel walls (vertex colour), a grid of windows (some lit warm, the rest sky-blue glass), shop fronts on the ground floor, light roofs.
// COLOR.rgb = wall colour, COLOR.a = a per-building number (0..0.97) that seeds which windows are lit; 1.0 marks a sidewalk pad.

varying vec3 wpos;
varying vec3 wnor;
varying vec4 vcol;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnor = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vcol = COLOR;
}

void fragment() {
	vec3 base = vcol.rgb;
	float seed = vcol.a;
	if (seed > 0.99) {
		vec2 g = fract(wpos.xz / 3.0);
		float joint = step(g.x, 0.03) + step(g.y, 0.03);
		ALBEDO = base * (1.0 - 0.14 * clamp(joint, 0.0, 1.0));
		ROUGHNESS = 1.0;
	} else if (abs(wnor.y) > 0.5) {
		// roof: lighter, with a darker rim
		vec3 c = mix(base, vec3(1.0), 0.35);
		ALBEDO = c;
		ROUGHNESS = 1.0;
	} else {
		float u = wpos.x * abs(wnor.z) + wpos.z * abs(wnor.x);
		float v = wpos.y;
		vec2 cell = vec2(u / 3.2, v / 3.6);
		vec2 id = floor(cell);
		vec2 f = fract(cell);
		vec3 c = base;
		float emis = 0.0;
		if (v < 3.4) {
			// shop front: a dark awning band and a big glass door area
			float awning = step(2.4, v) * step(v, 3.2);
			c = mix(base * 0.8, vec3(1.0, 0.45, 0.55), awning);
			float glass = step(0.3, v) * step(v, 2.2) * step(0.12, f.x) * step(f.x, 0.88);
			c = mix(c, vec3(0.55, 0.75, 0.9), glass * 0.9);
			emis = glass * step(0.55, hash(id + seed * 91.0)) * 0.35;
		} else {
			float inwin = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.78);
			float lit = step(0.62, hash(id + seed * 57.0));
			vec3 glass_col = mix(vec3(0.42, 0.62, 0.85), vec3(1.0, 0.86, 0.5), lit);
			c = mix(c, glass_col, inwin);
			emis = inwin * lit * 0.55;
			// a thin dark frame round each window
			float frame = step(0.14, f.x) * step(f.x, 0.86) * step(0.2, f.y) * step(f.y, 0.83) * (1.0 - inwin);
			c = mix(c, base * 0.55, frame);
			// floor bands
			c *= 1.0 - 0.1 * step(f.y, 0.06);
		}
		ALBEDO = c;
		EMISSION = c * emis;
		ROUGHNESS = 0.85;
	}
}
