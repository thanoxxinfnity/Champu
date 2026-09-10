'use client';

import { useMemo, useState } from 'react';
import { useWorkspace } from '@/lib/store';
import { downloadZip, downloadText, formatBytes } from '@/lib/zip';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  bytes?: number;
  children: TreeNode[];
}

function buildTree(paths: Array<{ path: string; bytes: number }>): TreeNode[] {
  const root: TreeNode[] = [];

  for (const { path, bytes } of paths.sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = path.split('/');
    let level = root;
    let accumulated = '';

    segments.forEach((segment, i) => {
      accumulated = accumulated ? `${accumulated}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;
      let node = level.find((n) => n.name === segment && n.isDir === !isLeaf);

      if (!node) {
        node = { name: segment, path: accumulated, isDir: !isLeaf, bytes: isLeaf ? bytes : undefined, children: [] };
        level.push(node);
      }
      level = node.children;
    });
  }

  // Directories before files, alphabetical within each group.
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      .map((n) => ({ ...n, children: sort(n.children) }));

  return sort(root);
}

function TreeRow({
  node,
  depth,
  activeFile,
  onSelect,
  collapsed,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelect: (path: string) => void;
  collapsed: Set<string>;
  toggle: (path: string) => void;
}) {
  const isCollapsed = collapsed.has(node.path);
  const isActive = activeFile === node.path;

  return (
    <>
      <button
        type="button"
        onClick={() => (node.isDir ? toggle(node.path) : onSelect(node.path))}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors"
        style={{
          paddingLeft: `${6 + depth * 12}px`,
          background: isActive ? 'color-mix(in oklab, var(--accent) 12%, transparent)' : undefined,
          color: isActive ? 'var(--accent)' : node.isDir ? 'var(--ink-dim)' : 'var(--ink)',
        }}
      >
        <span className="mono shrink-0 text-[9px]" style={{ color: 'var(--ink-faint)' }} aria-hidden>
          {node.isDir ? (isCollapsed ? '▸' : '▾') : '·'}
        </span>
        <span className="mono truncate text-[11.5px]">{node.name}</span>
        {node.bytes != null && (
          <span className="mono ml-auto shrink-0 pl-2 text-[9.5px]" style={{ color: 'var(--ink-faint)' }}>
            {formatBytes(node.bytes)}
          </span>
        )}
      </button>

      {node.isDir &&
        !isCollapsed &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            onSelect={onSelect}
            collapsed={collapsed}
            toggle={toggle}
          />
        ))}
    </>
  );
}

/** Generated-artifact browser with viewer, bridge sync and archive export. */
export function FileManager() {
  const files = useWorkspace((s) => s.files);
  const activeFile = useWorkspace((s) => s.activeFile);
  const setActiveFile = useWorkspace((s) => s.setActiveFile);
  const removeFile = useWorkspace((s) => s.removeFile);
  const bridge = useWorkspace((s) => s.bridge);
  const heartbeat = useWorkspace((s) => s.heartbeat);
  const appendTerminal = useWorkspace((s) => s.appendTerminal);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const list = useMemo(() => [...files.values()], [files]);
  const tree = useMemo(() => buildTree(list.map((f) => ({ path: f.path, bytes: f.bytes }))), [list]);
  const totalBytes = list.reduce((sum, f) => sum + f.bytes, 0);
  const current = activeFile ? files.get(activeFile) : null;

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const syncToBridge = async () => {
    if (!list.length) return;
    setSyncing(true);
    try {
      const result = await bridge.writeFiles(list.map((f) => ({ path: f.path, content: f.content })));
      appendTerminal({ stream: 'system', text: `⇪ synced ${result.count} file(s) to the bridge workspace` });
    } catch (err) {
      appendTerminal({ stream: 'system', text: `⚠  sync failed: ${(err as Error).message}` });
    } finally {
      setSyncing(false);
    }
  };

  if (!list.length) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-[13px]" style={{ color: 'var(--ink-dim)' }}>
            No generated files yet.
          </p>
          <p className="mt-1.5 text-[11.5px] leading-4" style={{ color: 'var(--ink-faint)' }}>
            Lane B runs write artifacts here as they stream.
          </p>
        </div>
      </div>
    );
  }

  const online = heartbeat.status === 'online' || heartbeat.status === 'degraded';

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-56 shrink-0 flex-col border-r" style={{ borderColor: 'var(--line)' }}>
        <header className="shrink-0 border-b px-2.5 py-2" style={{ borderColor: 'var(--line)' }}>
          <div className="mono text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--ink-faint)' }}>
            {list.length} file{list.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => downloadZip(list.map((f) => ({ path: f.path, content: f.content })), 'chomugiri-artifacts.zip')}
              className="mono flex-1 rounded border px-1.5 py-1 text-[10px] transition-colors"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-dim)' }}
            >
              .zip
            </button>
            <button
              type="button"
              onClick={() => void syncToBridge()}
              disabled={!online || syncing}
              className="mono flex-1 rounded border px-1.5 py-1 text-[10px] transition-colors disabled:opacity-35"
              style={{ borderColor: 'var(--line)', color: online ? 'var(--accent)' : 'var(--ink-faint)' }}
              title={online ? 'Write these files into the bridge workspace' : 'Bridge is offline'}
            >
              {syncing ? '…' : 'sync'}
            </button>
          </div>
        </header>

        <nav className="flex-1 overflow-y-auto p-1.5">
          {tree.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              onSelect={setActiveFile}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
        </nav>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <>
            <header
              className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: 'var(--line)' }}
            >
              <span className="mono truncate text-[11.5px]" style={{ color: 'var(--ink)' }}>
                {current.path}
              </span>
              <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                {current.language} · {formatBytes(current.bytes)}
              </span>

              <div className="ml-auto flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(current.content)}
                  className="mono text-[10.5px]"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  copy
                </button>
                <button
                  type="button"
                  onClick={() => downloadText(current.content, current.path.split('/').pop() ?? 'file.txt')}
                  className="mono text-[10.5px]"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  save
                </button>
                <button
                  type="button"
                  onClick={() => removeFile(current.path)}
                  className="mono text-[10.5px]"
                  style={{ color: 'var(--color-rose)' }}
                >
                  remove
                </button>
              </div>
            </header>

            <pre className="mono flex-1 overflow-auto p-3 text-[12px] leading-[1.6]" style={{ color: 'var(--ink)' }}>
              {current.content}
            </pre>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="mono text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              select a file
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
