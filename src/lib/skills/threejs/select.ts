/**
 * Which of the Three.js skills (see data.ts, from cloudai-x/threejs-skills) go in front of the model for a given request.
 *
 * The fundamentals — renderer, camera, resize, the loop — go in for every website, because they are what every scene shares and
 * what a model most often gets subtly wrong. Each of the others goes in only when the request is about its topic, and at most two do,
 * so a prompt stays a size a model can use (each skill is ~3-4k tokens).
 */
import { THREEJS_SKILLS, THREEJS_SKILLS_SOURCE, type ThreejsSkill } from './data.ts';

const TOPICS: Array<[string, RegExp]> = [
  ['threejs-geometry', /geometr|shape|sphere|cube|torus|particle|instanc|terrain|procedural|mesh|low[- ]?poly|point cloud|star ?field|galaxy/i],
  ['threejs-materials', /material|pbr|metal|glass|glossy|shiny|wireframe|toon|matte|transparen|chrome|plastic/i],
  ['threejs-lighting', /\blights?\b|lighting|shadow|glow|\bsun\b|lamp|neon|spotlight|ambient|atmospher|moody|dramatic/i],
  ['threejs-textures', /texture|hdri|environment map|skybox|\buv\b|reflection|normal map|bump|envmap/i],
  ['threejs-animation', /animat|motion|rotat|spin|float|keyframe|skeletal|morph|bounce|orbit|\bmove|wobble|breath/i],
  ['threejs-loaders', /\b(glb|gltf|obj|fbx|draco|ktx2)\b|3d model|load(ing)? (a )?model|import(ed)? model|\.glb/i],
  ['threejs-shaders', /shader|glsl|noise|gradient|wave|distort|ripple|dissolve|fresnel|aurora|plasma|hologram/i],
  ['threejs-postprocessing', /bloom|post[- ]?process|depth of field|glitch|blur|vignette|film grain|chromatic|effect ?composer/i],
  ['threejs-interaction', /click|hover|drag|raycast|scroll|mouse|touch|orbit ?controls|interactive|select|parallax|gesture|cursor/i],
];

const MAX_EXTRA = 2;

export function selectThreejsSkills(request: string): ThreejsSkill[] {
  const byId = new Map(THREEJS_SKILLS.map((s) => [s.id, s]));
  const scored = TOPICS
    .map(([id, re]) => ({ id, score: (request.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) ?? []).length }))
    .filter((t) => t.score > 0 && byId.has(t.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXTRA);
  const chosen = ['threejs-fundamentals', ...scored.map((t) => t.id)];
  return chosen.map((id) => byId.get(id)).filter((s): s is ThreejsSkill => !!s);
}

/** The section of the system prompt, or '' when there is nothing to say. */
export function threejsSkillsPrompt(request: string): string {
  const skills = selectThreejsSkills(request);
  if (!skills.length) return '';
  return [
    `## THREE.JS REFERENCE (${skills.map((s) => s.id.replace('threejs-', '')).join(', ')})`,
    `Accurate API notes and patterns for three.js, from ${THREEJS_SKILLS_SOURCE.repo} (${THREEJS_SKILLS_SOURCE.license}). Use them whenever the site draws anything with three.js — for a site that does not need 3D, skip them. In the browser, import through the import map given above (\`three\` and \`three/addons/\`), not from a package name.`,
    ...skills.map((s) => `### ${s.id}\n${s.body}`),
  ].join('\n\n');
}
