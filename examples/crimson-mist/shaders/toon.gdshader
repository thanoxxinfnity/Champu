shader_type spatial;
// Cel shading: three hard-edged light bands, a cool shadow tint, a soft rim light, optional world-space grime and emission.
// Used on every character and building so the whole game reads as one hand-inked anime frame (outline lives in outline.gdshader).

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform bool use_tex = false;
uniform vec4 albedo : source_color = vec4(1.0);
uniform vec4 shade_tint : source_color = vec4(0.48, 0.52, 0.66, 1.0);
uniform float band1 = 0.18;
uniform float band2 = 0.62;
uniform float softness = 0.025;
uniform vec4 rim_color : source_color = vec4(0.72, 0.82, 1.0, 1.0);
uniform float rim_power = 3.2;
uniform float rim_amount = 0.26;
uniform float alpha_cut = 0.0;
uniform vec4 emission_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float emission_energy = 1.0;
uniform float grime = 0.0;
uniform float flash = 0.0;
uniform float uv_scale = 1.0;

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
	vec4 t = use_tex ? texture(albedo_tex, UV * uv_scale) : vec4(1.0);
	vec3 c = albedo.rgb * t.rgb;
	if (grime > 0.0) {
		float n = vnoise(wpos.xz * 1.7) * 0.6 + vnoise(wpos.xz * 6.0 + wpos.y * 2.0) * 0.4;
		float streak = vnoise(vec2(wpos.x * 3.0 + wpos.z * 3.0, wpos.y * 0.7));
		c *= 1.0 - grime * (0.16 * n + 0.2 * streak * (1.0 - clamp(wnorm.y, 0.0, 1.0)));
	}
	ALBEDO = c + vec3(flash);
	if (alpha_cut > 0.0) {
		ALPHA = t.a * albedo.a;
		ALPHA_SCISSOR_THRESHOLD = alpha_cut;
	}
	EMISSION = emission_color.rgb * emission_energy;
	ROUGHNESS = 1.0;
	SPECULAR = 0.0;
}

void light() {
	float d = dot(NORMAL, LIGHT);
	float lit = smoothstep(band1 - softness, band1 + softness, d) * 0.55 + smoothstep(band2 - softness, band2 + softness, d) * 0.45;
	DIFFUSE_LIGHT += LIGHT_COLOR * ATTENUATION * mix(shade_tint.rgb * 0.38, vec3(1.0), lit) / 3.14159;
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), rim_power);
	SPECULAR_LIGHT += rim_color.rgb * rim * rim_amount * smoothstep(-0.2, 0.4, d) * LIGHT_COLOR * ATTENUATION / 3.14159;
}
