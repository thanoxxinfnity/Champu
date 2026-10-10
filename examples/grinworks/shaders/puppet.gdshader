shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

// Walk cycle for a TRELLIS character, which arrives as one rigid mesh with no
// skeleton. The mesh is a person standing in an A-pose, so the shader can find
// the legs and arms from where each vertex is in the model's bounding box:
//   legs  = below the hips, away from the centre line
//   arms  = shoulder height, far out to the sides
// and swing them about the hip and shoulder with a sine. The torso leans, bobs
// and sways. It is cheap (all in the vertex stage) and reads as a shamble.
//
// Everything here is in the mesh's own space, where a TRELLIS person faces +Z
// (Assets.make turns the whole model to Godot's -Z afterwards). The poses come
// as a T-pose or an A-pose, so `tpose` says how far the arms must be lowered.

uniform vec3 bmin = vec3(-0.5, 0.0, -0.5);
uniform vec3 bsize = vec3(1.0, 1.0, 1.0);
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform bool use_tex = false;
uniform vec3 tint = vec3(1.0);
uniform float shoulder = 0.12;   // shoulder joint, as a fraction of the model width, from the centre
uniform float hip = 0.06;        // hip joint, same units
uniform float tpose = 1.0;       // 1: arms start straight out (T-pose), 0: already hanging

uniform float phase = 0.0;      // advances with distance walked
uniform float speed = 0.0;      // 0 standing .. 1 full stride
uniform float lean = 0.0;       // forward hunch
uniform float arms_up = 0.0;    // 0 arms down .. 1 arms stretched forward
uniform float limp = 0.0;       // one-sided drag
uniform float flash = 0.0;      // hit flash 0..1
uniform float dark = 0.0;       // 0..1 darkens (dying)
uniform float roughness_v = 0.82;

varying float v_ao;

vec3 rot_x(vec3 p, vec3 pivot, float a) {
	float c = cos(a);
	float s = sin(a);
	vec3 d = p - pivot;
	return pivot + vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
}

vec3 rot_y(vec3 p, vec3 pivot, float a) {
	float c = cos(a);
	float s = sin(a);
	vec3 d = p - pivot;
	return pivot + vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
}

vec3 rot_z(vec3 p, vec3 pivot, float a) {
	float c = cos(a);
	float s = sin(a);
	vec3 d = p - pivot;
	return pivot + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
}

void vertex() {
	vec3 u = (VERTEX - bmin) / bsize;
	vec3 p = VERTEX;
	float side = u.x < 0.5 ? -1.0 : 1.0;
	float off = abs(u.x - 0.5);
	float stride = sin(phase) * speed;
	float stride2 = sin(phase + 3.14159) * speed;

	// Legs: weight rises as the vertex goes below the hip line and away from
	// the middle, so the pelvis stays in one piece.
	float leg_w = smoothstep(0.53, 0.40, u.y) * smoothstep(hip * 0.2, hip * 1.5, off);
	float leg_swing = (side < 0.0 ? stride : stride2) * 0.55;
	if (limp > 0.0 && side > 0.0) { leg_swing = leg_swing * (1.0 - 0.6 * limp) - 0.2 * limp * speed; }
	vec3 hip_pt = bmin + vec3((0.5 + side * hip) * bsize.x, 0.5 * bsize.y, 0.5 * bsize.z);
	p = mix(p, rot_x(p, hip_pt, leg_swing), leg_w);

	// Arms: out beyond the shoulder at chest height. Lowered from a T-pose,
	// swung against the legs while they hang, or thrown forward to reach.
	float arm_w = smoothstep(shoulder * 1.05, shoulder * 1.9, off) * smoothstep(0.40, 0.56, u.y) * smoothstep(1.0, 0.88, u.y);
	vec3 sh = bmin + vec3((0.5 + side * shoulder) * bsize.x, 0.80 * bsize.y, 0.5 * bsize.z);
	vec3 a = p;
	a = rot_z(a, sh, -side * tpose * 1.2 * (1.0 - arms_up));
	a = rot_x(a, sh, (side < 0.0 ? stride2 : stride) * 0.45 * (1.0 - arms_up));
	a = rot_y(a, sh, -side * 1.45 * arms_up);
	p = mix(p, a, arm_w);

	// Torso: hunch forward from the hips (+Z is the front here), sway, bob.
	float upper = smoothstep(0.45, 1.0, u.y);
	p.z += upper * upper * lean * bsize.y * 0.16;
	p.x += sin(phase * 0.5) * upper * speed * 0.03 * bsize.y;
	p.y += abs(sin(phase)) * speed * 0.012 * bsize.y;
	p.y -= limp * abs(sin(phase)) * speed * 0.02 * bsize.y;

	VERTEX = p;
	v_ao = mix(0.55, 1.0, smoothstep(0.0, 0.25, u.y));
}

void fragment() {
	vec3 col = COLOR.rgb;
	if (use_tex) {
		col = texture(albedo_tex, UV).rgb;
	}
	col *= tint * v_ao;
	col = mix(col, vec3(1.0, 0.18, 0.12), flash * 0.65);
	col *= 1.0 - dark * 0.7;
	ALBEDO = col;
	ROUGHNESS = roughness_v;
	EMISSION = vec3(1.0, 0.1, 0.05) * flash * 0.5;
}
