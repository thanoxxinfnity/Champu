'use client';
/**
 * One vault for the whole app: the Handoff area, the chat's Computer use and the Secured tab all see the same open/locked state.
 * The AES key lives in this module's memory only while the vault is open; storage holds the sealed (encrypted) copy.
 */
import { create } from 'zustand';
import { getSetting, setSetting } from '../db/history';
import { createVault, openVault, sealWith, type SealedVault, type VaultItem } from './vault';

export const VAULT_KEY = 'handoff.vault.v1';
const LOCK_AFTER_MS = 10 * 60_000;

let keyRef: { key: CryptoKey; salt: Uint8Array; iterations: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export interface VaultStore {
  loaded: boolean;
  sealed: SealedVault | null;
  items: VaultItem[];
  open: boolean;
  load: () => Promise<void>;
  create: (pin: string) => Promise<void>;
  unlock: (pin: string) => Promise<void>;
  lock: () => void;
  save: (items: VaultItem[]) => Promise<void>;
  reset: () => Promise<void>;
  touch: () => void;
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  loaded: false,
  sealed: null,
  items: [],
  open: false,
  load: async () => {
    if (get().loaded) return;
    const v = await getSetting<SealedVault | null>(VAULT_KEY, null).catch(() => null);
    set({ sealed: v && v.ct ? v : null, loaded: true });
  },
  lock: () => { keyRef = null; if (timer) clearTimeout(timer); set({ items: [], open: false }); },
  touch: () => { if (timer) clearTimeout(timer); timer = setTimeout(() => get().lock(), LOCK_AFTER_MS); },
  create: async (pin) => {
    const v = await createVault(pin, { items: [] });
    await setSetting(VAULT_KEY, v.sealed);
    keyRef = { key: v.key, salt: v.salt, iterations: v.sealed.iterations };
    set({ sealed: v.sealed, items: [], open: true, loaded: true });
    get().touch();
  },
  unlock: async (pin) => {
    await get().load();
    const sealed = get().sealed;
    if (!sealed) throw new Error('No vault yet.');
    const v = await openVault(sealed, pin);
    keyRef = { key: v.key, salt: v.salt, iterations: sealed.iterations };
    set({ items: v.data.items, open: true });
    get().touch();
  },
  save: async (items) => {
    const k = keyRef;
    if (!k) throw new Error('The vault is locked.');
    const s = await sealWith(k.key, k.salt, { items }, k.iterations);
    await setSetting(VAULT_KEY, s);
    set({ sealed: s, items });
    get().touch();
  },
  reset: async () => { await setSetting(VAULT_KEY, null); get().lock(); set({ sealed: null }); },
}));
