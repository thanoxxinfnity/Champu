shader_type sky;

// Gradient sky with a sun disc and glow, layered clouds lit from the sun
// side, and stars at night. No TIME, so the radiance map (reflections and
// ambient light) is only recomputed when the time of day changes.

uniform vec3 top_color : source_color = vec3(0.2, 0.35, 0.6);
uniform vec3 horizon_color : source_color = vec3(0.9, 0.65, 0.45);
uniform vec3 ground_color : source_color = vec3(0.15, 0.13, 0.12);
uniform vec3 sun_tint : source_color = vec3(1.0, 0.8, 0.55);
uniform float sun_disc = 0.9995;
uniform float sun_glow = 1.0;
uniform sampler2D cloud_noise : filter_linear_mipmap, repeat_enable;
uniform float cloud_cover = 0.45;
uniform vec3 cloud_light : source_color = vec3(1.0, 0.9, 0.8);
uniform vec3 cloud_shadow : source_color = vec3(0.45, 0.45, 0.55);
uniform float stars = 0.0;
uniform vec2 cloud_offset = vec2(0.0);

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void sky() {
	vec3 d = EYEDIR;
	float h = d.y;
	vec3 col;
	if (h >= 0.0) {
		col = mix(horizon_color, top_color, pow(clamp(h, 0.0, 1.0), 0.45));
	} else {
		col = mix(horizon_color, ground_color, clamp(-h * 6.0, 0.0, 1.0));
	}
	vec3 sun_dir = LIGHT0_DIRECTION;
	float sd = max(dot(d, sun_dir), 0.0);
	float above = smoothstep(-0.08, 0.05, sun_dir.y);
	col += sun_tint * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.6) * sun_glow * above;
	if (h > 0.0) {
		vec2 uv = d.xz / (h + 0.09) * 0.18 + cloud_offset;
		float c = texture(cloud_noise, uv).r * 0.65 + texture(cloud_noise, uv * 2.7 + 0.31).r * 0.35;
		float cover = smoothstep(1.0 - cloud_cover, 1.0 - cloud_cover + 0.28, c);
		cover *= smoothstep(0.0, 0.12, h);
		float lit = texture(cloud_noise, uv + sun_dir.xz * 0.02).r;
		vec3 cc = mix(cloud_shadow, cloud_light, clamp(0.55 + (c - lit) * 3.0, 0.0, 1.0));
		cc += sun_tint * pow(sd, 8.0) * 0.5 * above;
		col = mix(col, cc, cover * 0.92);
		if (stars > 0.0) {
			float s = step(0.9975, hash(floor(d * 380.0)));
			col += vec3(s) * stars * (1.0 - cover) * smoothstep(0.05, 0.3, h);
		}
	}
	if (AT_CUBEMAP_PASS == false) {
		col += vec3(step(sun_disc, sd)) * sun_tint * 6.0 * above;
	}
	COLOR = col;
}
