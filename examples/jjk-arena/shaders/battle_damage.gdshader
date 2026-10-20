shader_type spatial;
render_mode unshaded, cull_disabled;   // match the anime source material (flat, double-sided)
// Battle damage on a character's own texture. `tear` (0..1) grows with the damage taken:
//   shirt (dark cloth on the body mesh, chest height): ragged holes open up showing skin, with frayed dark edges and grime;
//   trousers (the cloth mesh): grime, scorch and rips, and only below the knee can a rip show skin, so the trousers never come off.
// The holes are painted on the same surface (no geometry removed), so nothing behind the cloth can show through.

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float tear = 0.0;
uniform bool is_shirt_mesh = true;      // body mesh (shirt painted on it); false = trousers mesh
uniform vec3 skin = vec3(0.95, 0.80, 0.72);
uniform float seed = 0.0;

varying vec3 mpos;

float hash(vec3 p) { p = fract(p * 0.3183099 + seed * 0.13); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
	vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
	           mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return noise(p) * 0.55 + noise(p * 2.3) * 0.3 + noise(p * 5.1) * 0.15; }

void vertex() {
	mpos = VERTEX;
}

void fragment() {
	vec4 base = texture(albedo_tex, UV) * albedo_color;
	vec3 c = base.rgb;
	float lum = dot(c, vec3(0.3, 0.59, 0.11));
	float n = fbm(mpos * 9.0);
	float rip_n = fbm(mpos * vec3(6.0, 14.0, 6.0) + 3.0);     // stretched noise -> long vertical rips
	float t = clamp(tear, 0.0, 1.0);
	// grime and scorch grow everywhere with damage
	float grime = smoothstep(0.6, 0.9, fbm(mpos * 11.0 + 11.0)) * t;
	c = mix(c, c * vec3(0.62, 0.58, 0.52), grime * 0.45);
	if (is_shirt_mesh) {
		float shirt = (1.0 - smoothstep(0.10, 0.20, lum)) * step(0.92, mpos.y) * (1.0 - step(1.55, mpos.y));
		float v = max(n, rip_n * 0.95);
		float thr = 0.86 - t * 0.36;                          // t = 1 -> roughly half the shirt is gone
		float hole = smoothstep(thr, thr + 0.015, v);
		float edge = smoothstep(thr - 0.035, thr, v) * (1.0 - hole);
		vec3 torn = mix(skin * (1.0 + 0.08 * noise(mpos * 40.0)), vec3(0.6, 0.05, 0.04), smoothstep(0.82, 0.95, noise(mpos * 22.0)) * t * 0.6);
		c = mix(c, torn, hole * shirt);
		c = mix(c, vec3(0.02), edge * shirt * 0.9);          // frayed black fibres around each hole
	} else {
		float rip = smoothstep(0.99 - t * 0.33, 1.01 - t * 0.33, rip_n);
		float below_knee = 1.0 - smoothstep(0.42, 0.5, mpos.y);
		c = mix(c, c * 0.45, (smoothstep(0.96 - t * 0.33, 0.99 - t * 0.33, rip_n) - rip) * 0.9);   // dark torn edges everywhere
		c = mix(c, skin * 0.92, rip * below_knee);                                       // skin only shows below the knee
	}
	ALBEDO = c;
	ROUGHNESS = 0.85;
	SPECULAR = 0.3;
}
