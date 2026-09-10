'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  cubeGeometry,
  humanoidGeometry,
  packUVs,
  quadrupedGeometry,
  textureTemplate,
  toBBModel,
  toGeoJson,
  validateGeometry,
  type Bone,
  type Geometry,
} from '@/lib/suites/minecraft/blockbench';
import { downloadText, downloadZip } from '@/lib/zip';

/**
 * In-browser voxel model editor.
 *
 * Renders Bedrock geometry with three.js using Minecraft's own coordinate
 * conventions: 1 model unit = 1/16 block, Y-up, and cube `origin` is the minimum
 * corner rather than the centre — getting that wrong is why hand-rolled Bedrock
 * previewers show models sunk into the floor.
 */

const UNIT = 1 / 16;

function buildScene(geo: Geometry, selectedBone: string | null): THREE.Group {
  const root = new THREE.Group();
  const boneGroups = new Map<string, THREE.Group>();

  // Pass 1 — create a group per bone, positioned at its pivot.
  for (const bone of geo.bones) {
    const group = new THREE.Group();
    group.name = bone.name;
    group.position.set(bone.pivot[0] * UNIT, bone.pivot[1] * UNIT, bone.pivot[2] * UNIT);

    if (bone.rotation) {
      group.rotation.set(
        THREE.MathUtils.degToRad(bone.rotation[0]),
        THREE.MathUtils.degToRad(bone.rotation[1]),
        THREE.MathUtils.degToRad(bone.rotation[2]),
      );
    }
    boneGroups.set(bone.name, group);
  }

  // Pass 2 — parent bones, subtracting the parent pivot so children stay put.
  for (const bone of geo.bones) {
    const group = boneGroups.get(bone.name)!;
    const parent = bone.parent ? boneGroups.get(bone.parent) : undefined;

    if (parent) {
      const parentBone = geo.bones.find((b) => b.name === bone.parent)!;
      group.position.set(
        (bone.pivot[0] - parentBone.pivot[0]) * UNIT,
        (bone.pivot[1] - parentBone.pivot[1]) * UNIT,
        (bone.pivot[2] - parentBone.pivot[2]) * UNIT,
      );
      parent.add(group);
    } else {
      root.add(group);
    }
  }

  // Pass 3 — cubes, offset from their bone's pivot.
  for (const bone of geo.bones) {
    if (bone.neverRender) continue;
    const group = boneGroups.get(bone.name)!;
    const isSelected = selectedBone === bone.name;

    for (const cube of bone.cubes ?? []) {
      const inflate = cube.inflate ?? 0;
      const [w, h, d] = cube.size;

      const box = new THREE.BoxGeometry(
        (w + inflate * 2) * UNIT,
        (h + inflate * 2) * UNIT,
        (d + inflate * 2) * UNIT,
      );

      const material = new THREE.MeshLambertMaterial({
        color: isSelected ? 0x10b981 : 0x8b8b93,
        transparent: isSelected,
        opacity: isSelected ? 0.92 : 1,
      });

      const mesh = new THREE.Mesh(box, material);

      // Bedrock origin is the min corner; three.js boxes are centred.
      mesh.position.set(
        (cube.origin[0] + w / 2 - bone.pivot[0]) * UNIT,
        (cube.origin[1] + h / 2 - bone.pivot[1]) * UNIT,
        (cube.origin[2] + d / 2 - bone.pivot[2]) * UNIT,
      );

      if (cube.rotation) {
        mesh.rotation.set(
          THREE.MathUtils.degToRad(cube.rotation[0]),
          THREE.MathUtils.degToRad(cube.rotation[1]),
          THREE.MathUtils.degToRad(cube.rotation[2]),
        );
      }

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(box),
        new THREE.LineBasicMaterial({ color: isSelected ? 0x10b981 : 0x3f3f46 }),
      );
      mesh.add(edges);
      group.add(mesh);
    }
  }

  return root;
}

export function BlockbenchStudio() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef({ theta: Math.PI / 4, phi: Math.PI / 3, radius: 3.2, dragging: false, lastX: 0, lastY: 0 });

  const [geo, setGeo] = useState<Geometry>(() => humanoidGeometry('geometry.custom_mob'));
  const [selectedBone, setSelectedBone] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState('custom_mob');

  const issues = useMemo(() => validateGeometry(geo), [geo]);

  // ── Renderer bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0e11);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      // WebGL unavailable (headless, blocked, or software rendering disabled).
      mount.innerHTML =
        '<div style="display:grid;place-items:center;height:100%;font-family:var(--font-mono);font-size:11px;color:var(--ink-faint);text-align:center;padding:24px">WebGL is unavailable in this browser.<br>Geometry editing and export still work — only the 3D preview is disabled.</div>';
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(4, 8, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x6366f1, 0.3);
    fill.position.set(-5, 2, -4);
    scene.add(fill);

    const grid = new THREE.GridHelper(4, 16, 0x27272a, 0x18181b);
    scene.add(grid);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    const tick = () => {
      const orbit = orbitRef.current;
      camera.position.set(
        orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
        orbit.radius * Math.cos(orbit.phi),
        orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      );
      camera.lookAt(0, 0.75, 0);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    // ── Orbit controls (hand-rolled; OrbitControls is an extra import for this) ──
    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      const orbit = orbitRef.current;
      orbit.dragging = true;
      orbit.lastX = e.clientX;
      orbit.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const orbit = orbitRef.current;
      if (!orbit.dragging) return;
      orbit.theta -= (e.clientX - orbit.lastX) * 0.008;
      orbit.phi = Math.max(0.12, Math.min(Math.PI - 0.12, orbit.phi - (e.clientY - orbit.lastY) * 0.008));
      orbit.lastX = e.clientX;
      orbit.lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      orbitRef.current.dragging = false;
      el.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const orbit = orbitRef.current;
      orbit.radius = Math.max(0.8, Math.min(12, orbit.radius + e.deltaY * 0.0022));
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      renderer.dispose();
      mount.removeChild(el);
    };
  }, []);

  // ── Rebuild the mesh whenever the geometry or selection changes ──────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    }

    const model = buildScene(geo, selectedBone);
    scene.add(model);
    modelRef.current = model;
  }, [geo, selectedBone]);

  const applyPreset = (kind: 'humanoid' | 'quadruped' | 'cube') => {
    const id = `geometry.${identifier || 'custom_mob'}`;
    setGeo(kind === 'humanoid' ? humanoidGeometry(id) : kind === 'quadruped' ? quadrupedGeometry(id) : cubeGeometry(id));
    setSelectedBone(null);
  };

  const repack = () => {
    const { bones, textureHeight } = packUVs(geo.bones, geo.textureWidth);
    setGeo({ ...geo, bones, textureHeight });
  };

  const updateBone = (name: string, patch: Partial<Bone>) => {
    setGeo((prev) => ({ ...prev, bones: prev.bones.map((b) => (b.name === name ? { ...b, ...patch } : b)) }));
  };

  const exportPack = () => {
    const short = geo.identifier.replace(/^geometry\./, '');
    const template = textureTemplate(geo);
    const entries: Array<{ path: string; content: string | Uint8Array }> = [
      { path: `models/entity/${short}.geo.json`, content: JSON.stringify(toGeoJson(geo), null, 2) },
      { path: `${short}.bbmodel`, content: JSON.stringify(toBBModel(geo, short), null, 2) },
    ];

    if (template) {
      const base64 = template.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      entries.push({ path: `textures/entity/${short}_uv_template.png`, content: bytes });
    }

    downloadZip(entries, `${short}-model.zip`);
  };

  const selected = geo.bones.find((b) => b.name === selectedBone);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex-1" ref={mountRef} style={{ background: '#0e0e11', cursor: 'grab' }}>
        <div
          className="mono pointer-events-none absolute left-3 top-3 rounded px-2 py-1 text-[10px]"
          style={{ background: 'rgba(0,0,0,0.5)', color: 'var(--ink-faint)' }}
        >
          drag to orbit · scroll to zoom · {geo.bones.filter((b) => !b.neverRender).length} bones ·{' '}
          {geo.bones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0)} cubes
        </div>

        {issues.length > 0 && (
          <div
            className="mono absolute bottom-3 left-3 right-3 max-h-24 overflow-y-auto rounded px-2 py-1.5 text-[10px] leading-[1.5]"
            style={{ background: 'rgba(0,0,0,0.65)', color: 'var(--color-amber)' }}
          >
            {issues.map((issue, i) => (
              <div key={i}>⚠ {issue}</div>
            ))}
          </div>
        )}
      </div>

      <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-l" style={{ borderColor: 'var(--line)' }}>
        <div className="space-y-2.5 border-b p-3" style={{ borderColor: 'var(--line)' }}>
          <div>
            <span className="mono block text-[9.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              identifier
            </span>
            <div className="mt-1 flex items-center gap-1">
              <span className="mono text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                geometry.
              </span>
              <input
                value={identifier}
                onChange={(e) => {
                  const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                  setIdentifier(value);
                  setGeo((prev) => ({ ...prev, identifier: `geometry.${value || 'model'}` }));
                }}
                className="mono min-w-0 flex-1 rounded border bg-transparent px-1.5 py-1 text-[10.5px] outline-none"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              />
            </div>
          </div>

          <div>
            <span className="mono block text-[9.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              preset
            </span>
            <div className="mt-1 flex gap-1">
              {(['humanoid', 'quadruped', 'cube'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="mono flex-1 rounded border px-1 py-1 text-[9.5px]"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
                >
                  {preset.slice(0, 5)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="mono block text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
                tex width
              </span>
              <input
                type="number"
                value={geo.textureWidth}
                min={16}
                step={16}
                onChange={(e) => setGeo({ ...geo, textureWidth: Math.max(16, Number(e.target.value) || 64) })}
                className="mono mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-[10.5px] outline-none"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              />
            </label>
            <label className="block">
              <span className="mono block text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
                tex height
              </span>
              <input
                type="number"
                value={geo.textureHeight}
                min={16}
                step={16}
                onChange={(e) => setGeo({ ...geo, textureHeight: Math.max(16, Number(e.target.value) || 64) })}
                className="mono mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-[10.5px] outline-none"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={repack}
            className="mono w-full rounded border px-2 py-1.5 text-[10px]"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            title="Shelf-pack every cube's box UV into the atlas"
          >
            auto-pack UVs
          </button>
        </div>

        <div className="flex-1 p-2">
          <span className="mono mb-1 block px-1 text-[9.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            bones
          </span>
          {geo.bones.map((bone) => (
            <button
              key={bone.name}
              type="button"
              onClick={() => setSelectedBone(selectedBone === bone.name ? null : bone.name)}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left"
              style={{
                background: selectedBone === bone.name ? 'color-mix(in oklab, var(--accent) 14%, transparent)' : undefined,
                color: selectedBone === bone.name ? 'var(--accent)' : bone.neverRender ? 'var(--ink-faint)' : 'var(--ink-dim)',
                paddingLeft: bone.parent ? '16px' : '6px',
              }}
            >
              <span className="mono truncate text-[10.5px]">{bone.name}</span>
              <span className="mono ml-auto shrink-0 text-[9px]" style={{ color: 'var(--ink-faint)' }}>
                {bone.neverRender ? 'locator' : `${bone.cubes?.length ?? 0}`}
              </span>
            </button>
          ))}
        </div>

        {selected && !selected.neverRender && (
          <div className="border-t p-3" style={{ borderColor: 'var(--line)' }}>
            <span className="mono block text-[9.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
              {selected.name} · pivot
            </span>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(['x', 'y', 'z'] as const).map((axis, i) => (
                <input
                  key={axis}
                  type="number"
                  value={selected.pivot[i]}
                  step={0.5}
                  onChange={(e) => {
                    const pivot = [...selected.pivot] as [number, number, number];
                    pivot[i] = Number(e.target.value) || 0;
                    updateBone(selected.name, { pivot });
                  }}
                  className="mono w-full rounded border bg-transparent px-1 py-1 text-[10px] outline-none"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                  aria-label={`pivot ${axis}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5 border-t p-3" style={{ borderColor: 'var(--line)' }}>
          <button
            type="button"
            onClick={exportPack}
            className="mono w-full rounded px-2 py-2 text-[10.5px] font-medium"
            style={{ background: 'var(--accent)', color: '#04150e' }}
          >
            export .geo.json + .bbmodel + UV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                JSON.stringify(toGeoJson(geo), null, 2),
                `${geo.identifier.replace(/^geometry\./, '')}.geo.json`,
                'application/json',
              )
            }
            className="mono w-full rounded border px-2 py-1.5 text-[10px]"
            style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
          >
            geometry only
          </button>
        </div>
      </div>
    </div>
  );
}
