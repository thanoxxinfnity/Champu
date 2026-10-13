'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A real, minimal 3D modelling studio: a perspective viewport, an outliner, Object-Mode transforms
 * (move/rotate/scale via a gizmo), a basic Edit Mode (drag individual vertices), primitive meshes to
 * start from, and GLB/OBJ import and export. Everything here actually mutates the three.js scene graph
 * and geometry buffers — Edit Mode writes straight into a mesh's position BufferAttribute, the same data
 * a real modeller edits, not a cosmetic overlay.
 *
 * Scoped deliberately small next to a real DCC tool: no sculpting, no UV editing, no undo stack yet.
 * Edit Mode is capped at a vertex count a browser can comfortably show as draggable handles — a bigger
 * mesh still opens and transforms fine in Object Mode, it just can't be vertex-edited here.
 */

type Mode = 'object' | 'edit';
type GizmoMode = 'translate' | 'rotate' | 'scale';

interface OutlinerEntry {
  id: number;
  name: string;
  object: any; // THREE.Object3D — typed loosely since three's types aren't imported at module scope
}

const EDIT_VERTEX_CAP = 4000;

export function ModelStudio({ src, title, onClose, onExport }: {
  src?: string;
  title?: string;
  onClose: () => void;
  onExport?: (blob: Blob, filename: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(src ? 'loading' : 'ready');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<Mode>('object');
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [wire, setWire] = useState(false);
  const [outliner, setOutliner] = useState<OutlinerEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
  const [editBlocked, setEditBlocked] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const api = useRef<{
    THREE: any;
    scene: any; camera: any; renderer: any; controls: any; gizmo: any;
    select: (object: any | null) => void;
    setGizmoMode: (m: GizmoMode) => void;
    setMode: (m: Mode) => void;
    setWire: (v: boolean) => void;
    addPrimitive: (kind: 'cube' | 'sphere' | 'cylinder' | 'cone') => void;
    importFile: (file: File) => Promise<void>;
    deleteSelected: () => void;
    exportGlb: () => Promise<Blob>;
    exportObj: () => string;
    syncOutliner: () => void;
    readTransform: (object: any) => typeof transform;
    writeTransform: (object: any, t: Partial<typeof transform>) => void;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const { TransformControls } = await import('three/examples/jsm/controls/TransformControls.js');
        const el = host.current;
        if (!el || disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
        camera.position.set(4.5, 3.4, 5.5);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 2.1);
        sun.position.set(3, 5, 4);
        scene.add(sun);
        const grid = new THREE.GridHelper(20, 40, 0x886644, 0x443322);
        scene.add(grid);

        const content = new THREE.Group();
        scene.add(content);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0.5, 0);

        const gizmo = new TransformControls(camera, renderer.domElement);
        gizmo.addEventListener('dragging-changed', (e: any) => { controls.enabled = !e.value; });
        scene.add((gizmo.getHelper ? gizmo.getHelper() : gizmo) as any);

        let nextId = 1;
        const idOf = new WeakMap<any, number>();
        let selected: any = null;
        let currentMode: Mode = 'object';

        // ---- Edit Mode vertex handles ----
        const vertGroup = new THREE.Group();
        vertGroup.visible = false;
        scene.add(vertGroup);
        let editMesh: any = null;
        let dragVertIndex = -1;
        let dragPlane = new THREE.Plane();
        let dragPoint = new THREE.Vector3();
        const raycaster = new THREE.Raycaster();
        const pointerNdc = new THREE.Vector2();

        function clearVertHandles() {
          while (vertGroup.children.length) vertGroup.remove(vertGroup.children[0]);
        }
        function buildVertHandles(mesh: any) {
          clearVertHandles();
          const pos = mesh.geometry?.attributes?.position;
          if (!pos) return;
          if (pos.count > EDIT_VERTEX_CAP) { setEditBlocked(`${pos.count.toLocaleString()} vertices — too many to edit interactively here (cap is ${EDIT_VERTEX_CAP.toLocaleString()}).`); return; }
          setEditBlocked(null);
          const box = new THREE.Box3().setFromBufferAttribute(pos);
          const handleSize = Math.max(0.01, box.getSize(new THREE.Vector3()).length() * 0.012);
          const handleGeo = new THREE.SphereGeometry(handleSize, 6, 6);
          const handleMat = new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false });
          for (let i = 0; i < pos.count; i++) {
            const h = new THREE.Mesh(handleGeo, handleMat);
            h.position.set(pos.getX(i), pos.getY(i), pos.getZ(i));
            h.userData.vertIndex = i;
            mesh.localToWorld(h.position);
            vertGroup.add(h);
          }
        }

        function select(object: any | null) {
          selected = object;
          setSelectedId(object ? idOf.get(object) ?? null : null);
          if (object) { gizmo.attach(object); api.current?.syncOutliner(); setTransform(readTransform(object)); }
          else gizmo.detach();
          if (currentMode === 'edit' && object?.isMesh) buildVertHandles(object); else clearVertHandles();
        }

        function readTransform(object: any) {
          const q = object.rotation;
          return {
            x: object.position.x, y: object.position.y, z: object.position.z,
            rx: THREE.MathUtils.radToDeg(q.x), ry: THREE.MathUtils.radToDeg(q.y), rz: THREE.MathUtils.radToDeg(q.z),
            sx: object.scale.x, sy: object.scale.y, sz: object.scale.z,
          };
        }
        function writeTransform(object: any, t: Partial<typeof transform>) {
          if (!object) return;
          const cur = readTransform(object);
          const next = { ...cur, ...t };
          object.position.set(next.x, next.y, next.z);
          object.rotation.set(THREE.MathUtils.degToRad(next.rx), THREE.MathUtils.degToRad(next.ry), THREE.MathUtils.degToRad(next.rz));
          object.scale.set(next.sx, next.sy, next.sz);
          setTransform(next);
        }

        function syncOutliner() {
          const list: OutlinerEntry[] = [];
          content.traverse((o: any) => {
            if (o.isMesh) {
              if (!idOf.has(o)) idOf.set(o, nextId++);
              list.push({ id: idOf.get(o)!, name: o.name || `Mesh ${idOf.get(o)}`, object: o });
            }
          });
          setOutliner(list);
        }

        async function loadGlb(url: string) {
          const gltf = await new GLTFLoader().loadAsync(url);
          const model = gltf.scene;
          frameAndAdd(model);
        }
        async function loadObj(url: string) {
          const obj = await new OBJLoader().loadAsync(url);
          obj.traverse((o: any) => { if (o.isMesh && !o.material) o.material = new THREE.MeshStandardMaterial({ color: 0xcf8a52 }); });
          frameAndAdd(obj);
        }
        function frameAndAdd(model: any) {
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          model.position.y += size.y / 2;
          content.add(model);
          const radius = Math.max(size.x, size.y, size.z) || 1;
          camera.position.set(radius * 1.6, radius * 1.1, radius * 1.9);
          controls.target.set(0, size.y / 2, 0);
          camera.near = radius / 100; camera.far = radius * 100; camera.updateProjectionMatrix();
          syncOutliner();
          const firstMesh = (() => { let f: any = null; model.traverse((o: any) => { if (!f && o.isMesh) f = o; }); return f; })();
          if (firstMesh) select(firstMesh);
        }

        function addPrimitive(kind: 'cube' | 'sphere' | 'cylinder' | 'cone') {
          const geo = kind === 'cube' ? new THREE.BoxGeometry(1, 1, 1)
            : kind === 'sphere' ? new THREE.SphereGeometry(0.6, 24, 16)
            : kind === 'cylinder' ? new THREE.CylinderGeometry(0.6, 0.6, 1.2, 24)
            : new THREE.ConeGeometry(0.6, 1.2, 24);
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.45, metalness: 0.1 }));
          mesh.position.y = 0.5;
          content.add(mesh);
          syncOutliner();
          select(mesh);
        }

        function deleteSelected() {
          if (!selected) return;
          content.remove(selected);
          select(null);
          syncOutliner();
        }

        async function exportGlb(): Promise<Blob> {
          return new Promise((resolve, reject) => {
            new GLTFExporter().parse(content, (result) => {
              const bytes = result instanceof ArrayBuffer ? result : new TextEncoder().encode(JSON.stringify(result));
              resolve(new Blob([bytes], { type: 'model/gltf-binary' }));
            }, (err) => reject(err), { binary: true });
          });
        }
        function exportObj(): string {
          return new OBJExporter().parse(content);
        }

        // ---- pointer interaction: select in Object Mode, drag a vertex in Edit Mode ----
        function setPointerFromEvent(e: PointerEvent) {
          const rect = renderer.domElement.getBoundingClientRect();
          pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        }
        function onPointerDown(e: PointerEvent) {
          if (gizmo.dragging) return;
          setPointerFromEvent(e);
          raycaster.setFromCamera(pointerNdc, camera);
          if (currentMode === 'edit' && vertGroup.visible) {
            const hit = raycaster.intersectObjects(vertGroup.children, false)[0];
            if (hit) {
              dragVertIndex = hit.object.userData.vertIndex;
              const normal = new THREE.Vector3();
              camera.getWorldDirection(normal);
              dragPlane.setFromNormalAndCoplanarPoint(normal, hit.point);
              controls.enabled = false;
              renderer.domElement.setPointerCapture(e.pointerId);
              return;
            }
          }
          if (mode === 'object') {
            const hit = raycaster.intersectObjects(content.children, true)[0];
            let meshHit: any = hit?.object ?? null;
            while (meshHit && !meshHit.isMesh) meshHit = meshHit.parent;
            select(meshHit);
          }
        }
        function onPointerMove(e: PointerEvent) {
          if (dragVertIndex < 0 || !editMesh) return;
          setPointerFromEvent(e);
          raycaster.setFromCamera(pointerNdc, camera);
          if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            const handle = vertGroup.children.find((c: any) => c.userData.vertIndex === dragVertIndex);
            if (handle) handle.position.copy(dragPoint);
            const local = editMesh.worldToLocal(dragPoint.clone());
            const pos = editMesh.geometry.attributes.position;
            pos.setXYZ(dragVertIndex, local.x, local.y, local.z);
            pos.needsUpdate = true;
            editMesh.geometry.computeVertexNormals();
            editMesh.geometry.computeBoundingSphere();
          }
        }
        function onPointerUp(e: PointerEvent) {
          if (dragVertIndex >= 0) { dragVertIndex = -1; controls.enabled = true; renderer.domElement.releasePointerCapture(e.pointerId); }
        }
        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        renderer.domElement.addEventListener('pointermove', onPointerMove);
        renderer.domElement.addEventListener('pointerup', onPointerUp);

        function setModeImpl(m: Mode) {
          currentMode = m;
          if (m === 'edit' && selected?.isMesh) { editMesh = selected; vertGroup.visible = true; buildVertHandles(selected); gizmo.detach(); }
          else { editMesh = null; vertGroup.visible = false; clearVertHandles(); if (selected) gizmo.attach(selected); }
        }
        function setWireImpl(v: boolean) {
          content.traverse((o: any) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => { if (m) m.wireframe = v; }); });
        }

        api.current = {
          THREE, scene, camera, renderer, controls, gizmo,
          select, setGizmoMode: (m) => { gizmo.setMode(m); }, setMode: setModeImpl, setWire: setWireImpl,
          addPrimitive, importFile: async (file: File) => {
            const url = URL.createObjectURL(file);
            try {
              if (/\.obj$/i.test(file.name)) await loadObj(url); else await loadGlb(url);
            } finally { URL.revokeObjectURL(url); }
          },
          deleteSelected, exportGlb, exportObj, syncOutliner, readTransform, writeTransform,
        };

        const resize = () => {
          const w = el.clientWidth || 1, h = el.clientHeight || 1;
          renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize); ro.observe(el);
        let raf = 0;
        const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
        tick();

        if (src) { await loadGlb(src); }
        setState('ready');

        cleanup = () => {
          cancelAnimationFrame(raf); ro.disconnect();
          renderer.domElement.removeEventListener('pointerdown', onPointerDown);
          renderer.domElement.removeEventListener('pointermove', onPointerMove);
          renderer.domElement.removeEventListener('pointerup', onPointerUp);
          controls.dispose(); gizmo.dispose(); renderer.dispose(); renderer.domElement.remove();
        };
      } catch (err) {
        if (!disposed) { setState('error'); setMessage((err as Error).message || 'The studio could not start.'); }
      }
    })();
    return () => { disposed = true; cleanup(); api.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.current?.setMode(mode); }, [mode]);
  useEffect(() => { api.current?.setGizmoMode(gizmoMode); }, [gizmoMode]);
  useEffect(() => { api.current?.setWire(wire); }, [wire]);

  const selectedEntry = outliner.find((o) => o.id === selectedId) ?? null;

  const doExport = async (kind: 'glb' | 'obj') => {
    if (!api.current) return;
    if (kind === 'glb') {
      const blob = await api.current.exportGlb();
      onExport ? onExport(blob, `${title || 'model'}.glb`) : triggerDownload(blob, `${title || 'model'}.glb`);
    } else {
      const text = api.current.exportObj();
      const blob = new Blob([text], { type: 'text/plain' });
      onExport ? onExport(blob, `${title || 'model'}.obj`) : triggerDownload(blob, `${title || 'model'}.obj`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col sm:p-4" style={{ background: 'rgba(8,6,4,0.94)', color: 'var(--ink)' }} role="dialog" aria-modal="true" aria-label={title ?? '3D Studio'} data-testid="model-studio">
      <div className="mx-auto flex h-full w-full max-w-6xl min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border sm:flex-row" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
        {/* Outliner */}
        <aside className="order-2 flex max-h-40 shrink-0 flex-col overflow-y-auto border-t p-2 sm:order-1 sm:max-h-none sm:w-44 sm:border-r sm:border-t-0" style={{ borderColor: 'var(--line)' }}>
          <p className="mono mb-1 px-1 text-[9.5px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Outliner</p>
          <div className="relative mb-1">
            <button type="button" onClick={() => setAddOpen((v) => !v)} className="press mono w-full rounded-lg border px-2 py-1 text-left text-[11px]" style={{ borderColor: 'var(--line)' }}>+ Add mesh</button>
            {addOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-32 rounded-lg border p-1 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                {(['cube', 'sphere', 'cylinder', 'cone'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => { api.current?.addPrimitive(k); setAddOpen(false); }} className="press mono block w-full rounded px-2 py-1 text-left text-[11px] capitalize">{k}</button>
                ))}
              </div>
            )}
          </div>
          <ul className="space-y-1">
            {outliner.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => api.current?.select(o.object)} className="press mono w-full truncate rounded-lg border px-2 py-1 text-left text-[11px]" style={{ borderColor: o.id === selectedId ? 'var(--accent)' : 'var(--line)', color: 'var(--ink-dim)' }}>⬡ {o.name}</button>
              </li>
            ))}
            {outliner.length === 0 && <li className="px-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>Empty scene — add a mesh or import a file.</li>}
          </ul>
        </aside>

        {/* Viewport */}
        <section className="relative order-1 flex min-h-[16rem] min-w-0 flex-1 flex-col sm:order-2">
          <div ref={host} className="min-h-0 flex-1" data-testid="model-studio-viewport" />
          {state === 'loading' && <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--ink-dim)' }}>Opening model…</p>}
          {state === 'error' && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px]" role="alert" style={{ color: 'var(--color-red, #e5484d)' }}>{message}</p>}
          {editBlocked && mode === 'edit' && <p className="absolute left-2 top-2 max-w-xs rounded-lg border px-2 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)', background: 'var(--panel)', color: 'var(--ink-dim)' }}>{editBlocked}</p>}

          {/* top toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t px-2 py-1.5" style={{ borderColor: 'var(--line)' }}>
            <div className="mono flex overflow-hidden rounded-lg border text-[10.5px]" style={{ borderColor: 'var(--line)' }}>
              {(['object', 'edit'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className="press px-2.5 py-1 capitalize" style={{ background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? 'var(--panel)' : 'var(--ink-dim)' }}>{m}</button>
              ))}
            </div>
            {mode === 'object' && (
              <div className="mono flex overflow-hidden rounded-lg border text-[10.5px]" style={{ borderColor: 'var(--line)' }}>
                {(['translate', 'rotate', 'scale'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setGizmoMode(m)} className="press px-2.5 py-1 capitalize" style={{ background: gizmoMode === m ? 'var(--accent-2, var(--accent))' : 'transparent', color: gizmoMode === m ? 'var(--panel)' : 'var(--ink-dim)' }}>{m}</button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setWire((v) => !v)} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: wire ? 'var(--accent)' : 'var(--line)' }}>wireframe</button>
            {selectedEntry && mode === 'object' && <button type="button" onClick={() => api.current?.deleteSelected()} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]">delete</button>}
            <label className="press mono cursor-pointer rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)' }}>
              import
              <input type="file" accept=".glb,.gltf,.obj" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void api.current?.importFile(f); e.target.value = ''; }} />
            </label>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => void doExport('glb')} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)' }}>export .glb</button>
              <button type="button" onClick={() => void doExport('obj')} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)' }}>export .obj</button>
              <button type="button" onClick={onClose} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)' }}>close</button>
            </div>
          </div>
        </section>

        {/* Properties */}
        {mode === 'object' && (
          <aside className="order-3 shrink-0 border-t p-2 sm:w-48 sm:border-l sm:border-t-0" style={{ borderColor: 'var(--line)' }}>
            <p className="mono mb-1.5 px-1 text-[9.5px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>Properties</p>
            {!selectedEntry ? (
              <p className="px-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>Select a mesh.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as const).map((k) => (
                  <label key={`p${k}`} className="flex flex-col gap-0.5 text-[9px]" style={{ color: 'var(--ink-faint)' }}>{k.toUpperCase()}
                    <input type="number" step={0.1} value={Math.round(transform[k] * 1000) / 1000}
                      onChange={(e) => api.current?.writeTransform(selectedEntry.object, { [k]: Number(e.target.value) || 0 })}
                      className="mono rounded border bg-transparent px-1 py-0.5 text-[10.5px]" style={{ borderColor: 'var(--line)' }} />
                  </label>
                ))}
                {(['rx', 'ry', 'rz'] as const).map((k) => (
                  <label key={k} className="flex flex-col gap-0.5 text-[9px]" style={{ color: 'var(--ink-faint)' }}>R{k[1]!.toUpperCase()}
                    <input type="number" step={1} value={Math.round(transform[k])}
                      onChange={(e) => api.current?.writeTransform(selectedEntry.object, { [k]: Number(e.target.value) || 0 })}
                      className="mono rounded border bg-transparent px-1 py-0.5 text-[10.5px]" style={{ borderColor: 'var(--line)' }} />
                  </label>
                ))}
                {(['sx', 'sy', 'sz'] as const).map((k) => (
                  <label key={k} className="flex flex-col gap-0.5 text-[9px]" style={{ color: 'var(--ink-faint)' }}>S{k[1]!.toUpperCase()}
                    <input type="number" step={0.1} value={Math.round(transform[k] * 1000) / 1000}
                      onChange={(e) => api.current?.writeTransform(selectedEntry.object, { [k]: Math.max(0.001, Number(e.target.value) || 1) })}
                      className="mono rounded border bg-transparent px-1 py-0.5 text-[10.5px]" style={{ borderColor: 'var(--line)' }} />
                  </label>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
