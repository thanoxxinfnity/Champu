shader_type spatial;
// Textured cel surface for architecture and ground: the picture and normal map are projected along the dominant world axis (every wall,
// floor and roof of a box-built town gets a metric, seamless texture without UVs), then lit with the same three hard bands as toon.gdshader.
// `tile` = metres per texture repeat. `wet` darkens the foot of a wall, `grime` adds soot streaks, `lit` makes window glass glow.

uniform sampler2D tex_d : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_n : hint_normal, filter_linear_mipmap, repeat_enable;
uniform bool use_normal = true;
uniform vec4 tint : source_color = vec4(1.0);
uniform float tile = 3.0;
uniform float normal_strength = 1.0;
uniform vec4 shade_tint : source_color = vec4(0.46, 0.5, 0.66, 1.0);
uniform float band1 = 0.18;
uniform float band2 = 0.62;
uniform float softness = 0.03;
uniform float rim_amount = 0.12;
uniform float wet = 0.0;
uniform float grime = 0.0;
uniform vec4 emission_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float emission_energy = 1.0;
uniform vec2 offset = vec2(0.0);

varying vec3 wpos;
varying vec3 wnorm;

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
	wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 an = abs(wnorm);
	vec2 uv;
	vec3 T;
	vec3 B;
	if (an.y >= an.x && an.y >= an.z) {
		uv = wpos.xz;
		T = vec3(1, 0, 0);
		B = vec3(0, 0, 1);
	} else if (an.x >= an.z) {
		uv = vec2(wpos.z, -wpos.y);
		T = vec3(0, 0, 1);
		B = vec3(0, -1, 0);
	} else {
		uv = vec2(wpos.x, -wpos.y);
		T = vec3(1, 0, 0);
		B = vec3(0, -1, 0);
	}
	uv = uv / tile + offset;
	vec3 c = texture(tex_d, uv).rgb * tint.rgb;
	if (use_normal) {
		vec3 nt = texture(tex_n, uv).rgb;
		vec2 xy = (nt.xy * 2.0 - 1.0) * normal_strength;
		float z = sqrt(max(1.0 - dot(xy, xy), 0.0));
		vec3 nw = normalize(T * xy.x + B * -xy.y + wnorm * z);
		NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	}
	if (wet > 0.0) {
		float h = clamp(1.0 - wpos.y / 2.2, 0.0, 1.0);
		c *= 1.0 - wet * h * h * (0.45 + 0.4 * vnoise(wpos.xz * 2.3 + wpos.y));
	}
	if (grime > 0.0) {
		float streak = vnoise(vec2((wpos.x + wpos.z) * 2.6, wpos.y * 0.55));
		float blot = vnoise(wpos.xz * 1.3 + wpos.y * 0.4);
		c *= 1.0 - grime * (0.22 * streak * (1.0 - clamp(wnorm.y, 0.0, 1.0)) + 0.16 * blot);
	}
	ALBEDO = c;
	EMISSION = emission_color.rgb * emission_energy;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}

void light() {
	float d = dot(NORMAL, LIGHT);
	float lit = smoothstep(band1 - softness, band1 + softness, d) * 0.55 + smoothstep(band2 - softness, band2 + softness, d) * 0.45;
	DIFFUSE_LIGHT += LIGHT_COLOR * ATTENUATION * mix(shade_tint.rgb * 0.4, vec3(1.0), lit) / 3.14159;
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	SPECULAR_LIGHT += vec3(0.7, 0.8, 1.0) * rim * rim_amount * smoothstep(-0.2, 0.4, d) * LIGHT_COLOR * ATTENUATION / 3.14159;
}
