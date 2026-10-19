// Shared by the Infinite Void sky and the mirror floor, so the floor reflects exactly what the sky shows.
uniform vec3 deep_blue : source_color = vec3(0.02, 0.05, 0.28);
uniform vec3 purple : source_color = vec3(0.30, 0.06, 0.50);
uniform vec3 void_black : source_color = vec3(0.004, 0.004, 0.02);
uniform float pan_speed = 0.012;
uniform float pulse_speed = 1.6;
uniform vec3 core_color : source_color = vec3(0.75, 0.9, 1.0);

float vh(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(vh(i), vh(i + vec3(1, 0, 0)), f.x), mix(vh(i + vec3(0, 1, 0)), vh(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(vh(i + vec3(0, 0, 1)), vh(i + vec3(1, 0, 1)), f.x), mix(vh(i + vec3(0, 1, 1)), vh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * vnoise(p);
		p = p * 2.03 + vec3(1.7, 9.2, 3.1);
		a *= 0.5;
	}
	return s;
}

mat2 rot(float a) {
	float c = cos(a);
	float s = sin(a);
	return mat2(vec2(c, -s), vec2(s, c));
}

// Colour of the void in direction `d` (unit vector) at time `t`.
vec3 void_color(vec3 d, float t) {
	// slow rotation (UV rotation / panning) of the whole star field around the vertical axis
	vec3 q = d;
	q.xz = rot(t * pan_speed) * q.xz;
	float h = q.y * 0.5 + 0.5;
	// dynamic gradient: dark void at the horizon, blue in the middle, purple towards the zenith
	vec3 col = mix(void_black, deep_blue, smoothstep(0.0, 0.55, h));
	col = mix(col, purple, smoothstep(0.45, 1.0, h) * (0.6 + 0.4 * sin(t * 0.2)));
	// nebula: two panned noise layers
	float n1 = fbm(q * 2.2 + vec3(t * 0.02, 0.0, t * 0.015));
	float n2 = fbm(q * 4.5 - vec3(0.0, t * 0.03, 0.0));
	col += purple * smoothstep(0.45, 0.85, n1) * 0.55 + deep_blue * smoothstep(0.5, 0.9, n2) * 0.8;
	// stars: three scales of hashed cells, each twinkling
	for (int i = 0; i < 3; i++) {
		float sc = 38.0 + float(i) * 34.0;
		vec3 g = q * sc;
		vec3 id = floor(g);
		vec3 f = fract(g) - 0.5;
		float r = vh(id + float(i) * 7.0);
		float star = smoothstep(0.12, 0.0, length(f)) * step(0.90, r);
		col += vec3(0.8, 0.9, 1.0) * star * (0.6 + 0.4 * sin(t * 2.0 + r * 40.0));
	}
	// cosmic iris / singularity at the centre of the ceiling
	float ang = acos(clamp(d.y, -1.0, 1.0));
	float pulse = 0.5 + 0.5 * sin(t * pulse_speed);
	float core = smoothstep(0.16 + 0.03 * pulse, 0.0, ang);
	float ring = smoothstep(0.035, 0.0, abs(ang - (0.27 + 0.05 * pulse))) * 0.9;
	float swirl = 0.5 + 0.5 * sin(atan(d.z, d.x) * 6.0 + t * 1.5 - ang * 30.0);
	col += core_color * (core * 2.2 + ring * (0.5 + 0.5 * swirl)) * (0.7 + 0.3 * pulse);
	col += purple * smoothstep(0.7, 0.0, ang) * 0.35 * (0.6 + pulse * 0.4);
	return col;
}
