'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Turns a 3D model (GLB) around on screen: drag to orbit, wheel or pinch to zoom, optional wireframe and spin.
 * three.js is loaded only when a model is opened.
 */
export function ModelViewer({ src, title, onClose, overlay }: { src: string; title?: string; onClose?: () => void; overlay?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [wire, setWire] = useState(false);
  const [spin, setSpin] = useState(true);
  const api = useRef<{ setWire: (v: boolean) => void; setSpin: (v: boolean) => void } | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const el = host.current;
        if (!el || disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(3, 5, 4);
        scene.add(sun);
        scene.add(new THREE.GridHelper(10, 20, 0x886644, 0x443322));
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.6;

        const gltf = await new GLTFLoader().loadAsync(src);
        if (disposed) return;
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.position.y += size.y / 2;
        scene.add(model);
        const radius = Math.max(size.x, size.y, size.z) || 1;
        camera.position.set(radius * 1.6, radius * 1.1, radius * 1.9);
        controls.target.set(0, size.y / 2, 0);
        camera.near = radius / 100; camera.far = radius * 100; camera.updateProjectionMatrix();

        api.current = {
          setWire: (v) => model.traverse((o: any) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => { m.wireframe = v; }); }),
          setSpin: (v) => { controls.autoRotate = v; },
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
        setState('ready');
        cleanup = () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); };
      } catch (err) {
        if (!disposed) { setState('error'); setMessage((err as Error).message || 'This model could not be opened.'); }
      }
    })();
    return () => { disposed = true; cleanup(); api.current = null; };
  }, [src]);

  useEffect(() => { api.current?.setWire(wire); }, [wire, state]);
  useEffect(() => { api.current?.setSpin(spin); }, [spin, state]);

  const body = (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={host} className="min-h-0 flex-1" data-testid="model-viewport" />
      {state === 'loading' && <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--ink-dim)' }}>Opening model…</p>}
      {state === 'error' && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px]" role="alert" style={{ color: 'var(--color-red, #e5484d)' }}>{message}</p>}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: 'var(--ink-dim)' }}>{title}</span>
        <button type="button" onClick={() => setSpin((v) => !v)} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: spin ? 'var(--accent)' : 'var(--line)' }}>spin</button>
        <button type="button" onClick={() => setWire((v) => !v)} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: wire ? 'var(--accent)' : 'var(--line)' }}>wireframe</button>
        {onClose && <button type="button" onClick={onClose} className="press mono rounded-lg border px-2.5 py-1 text-[10.5px]" style={{ borderColor: 'var(--line)' }}>close</button>}
      </div>
    </div>
  );
  return overlay ? (
    <div className="fixed inset-0 z-50 p-3 sm:p-8" style={{ background: 'rgba(8,6,4,0.9)', color: 'var(--ink)' }} role="dialog" aria-modal="true" aria-label={title ?? '3D model'}>
      <div className="mx-auto h-full max-w-4xl overflow-hidden rounded-2xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>{body}</div>
    </div>
  ) : body;
}
