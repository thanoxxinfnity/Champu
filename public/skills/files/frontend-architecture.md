# Frontend Architecture (portable, module-based)
## When to Use

Use this skill when you need a portable, framework-agnostic architecture style for any React or React Native frontend. Organizes apps into feature modules with page/screen directories, a strict server-state vs UI-state split, barrel-only cross-module imports, co-located styles, and clear component-promotion rules....


> Portable skill — readable by Claude Code, OpenCode, Codex, Cursor, Windsurf, and others.
> This skill describes a **structure and a set of rules**, not a component library, a state library, or a visual style.
> It is deliberately global: the same module/page/state model maps onto
> **Next.js (App Router)**, **React + Vite (SPA)**, **Remix**, and **Expo / React Native**, and it works
> with **any** state-management and styling stack.

The goal: a codebase where any contributor can instantly answer three questions —
**"where does this code live?"**, **"what is allowed to import what?"**, and **"is this server state or UI state?"** —
without asking anyone. The structure makes the answers obvious.

---

## 0. The five core ideas

1. **Feature modules own their world.** Each feature is a self-contained `modules/{feature}/` folder with its own pages, components, hooks, state, types, and a single public barrel.
2. **Pages/screens are directories, not files.** A route is a folder that co-locates its component, its styles, and the components/hooks used only by it.
3. **State is split by origin.** Server data lives in a query/cache layer. UI/client state lives in a store. They never overlap — regardless of which libraries you pick.
4. **Imports cross boundaries only through barrels.** Reaching into another module's internals is forbidden; you import from `@/modules/{feature}` and nothing deeper.
5. **Code is promoted, not pre-placed.** It starts as local as possible and moves outward only when a second consumer appears.

Everything below is the mechanical application of these five ideas. None of it is tied to a specific library — pick your stack in Sections 4 and 6.

---

## 1. Directory layout

The shape is identical across frameworks; only the routing layer on top differs (see Section 7).

```
src/
├── app/ or routes/ or navigation/   ← framework routing layer (thin — see §7)
├── modules/                         ← feature modules (the heart of the app)
│   └── {feature}/
│       ├── index.ts                 ← PUBLIC BARREL — the only cross-module entry point
│       ├── README.md                ← what this module owns, its routes, its data deps
│       ├── components/              ← components reused by 2+ pages IN THIS MODULE
│       ├── pages/                   ← page/screen directories (one per route)
│       │   └── {page}/
│       │       ├── {page}.tsx               ← the page/screen component
│       │       ├── {page}.styles.ts         ← ALL styling for this page
│       │       ├── index.ts                 ← re-exports the page component
│       │       ├── components/              ← components used ONLY by this page
│       │       ├── hooks/                   ← hooks used ONLY by this page
│       │       ├── constants/
│       │       └── README.md                ← route, params, permissions, data deps
│       ├── hooks/                   ← data hooks (query/mutation) + module hooks
│       ├── stores/                  ← UI/client state store(s) — never server data
│       ├── services/                ← data-access (API calls) for this feature
│       ├── utils/                   ← pure module utilities (co-located *.test.ts)
│       ├── constants/
│       └── types/                   ← module request/response + view-model types
└── shared/                          ← cross-module building blocks
    ├── components/                  ← components used by 2+ MODULES
    ├── hooks/                       ← cross-cutting hooks
    ├── api-client/                  ← one typed client; the only place that talks to the network
    ├── store/                       ← root store wiring (if your state lib needs one — see §4)
    ├── utils/                       ← formatters, cn()/clsx, helpers
    ├── constants/
    └── types/
```

Every folder that can be empty at scaffold time keeps a `.gitkeep` so the structure is visible from day one.

---

## 2. Feature modules

A module is a vertical slice of the product (e.g. `auth`, `billing`, `dashboard`, `settings`). It contains everything that feature needs and exposes a deliberately small surface.

### 2.1 The barrel (`index.ts`) is the contract

`modules/{feature}/index.ts` is the **only** thing other modules and the routing layer may import from. It re-exports:

- Page/screen components the router mounts.
- Data hooks other features legitimately need.
- The store hook/slice and its public types.
- Shared constants / types other features depend on.

```ts
// CORRECT — consume the public surface
import { InvoiceListPage, useInvoiceList } from "@/modules/invoice";

// WRONG — reaching into internals couples you to private structure
import { InvoiceListPage } from "@/modules/invoice/pages/invoice-list/invoice-list";
```

Keep the barrel curated. If something isn't exported, it's private by design. Group exports with short comments (pages, hooks, store, types) — future readers use the barrel as the module's API docs.

### 2.2 One module = one bounded context

Don't create `utils` modules or `components` modules. Modules map to product capabilities, not to technical layers. Technical building blocks live in `shared/`.

### 2.3 Module README

Each module's `README.md` states: what it owns, which routes render its pages, its data dependencies (which endpoints/hooks), and any cross-module rules. This is the first thing a new contributor reads.

---

## 3. Pages/screens as directories

A page is a route the router mounts (a "screen" in React Native). It is **always a folder**, never a loose file — even when it starts as a single component. This keeps growth in place: when the page needs a sub-component or a hook, there is already a home for it.

```
pages/{page}/
├── {page}.tsx          ← the page/screen component
├── {page}.styles.ts    ← every style for this page (no inline styles — see §5)
├── index.ts            ← export { PageComponent } from "./{page}"
├── components/         ← used ONLY by this page
├── hooks/              ← used ONLY by this page
├── constants/
└── README.md           ← route, params, permissions, data deps
```

The page README is short and high-signal: route path, expected params, required permissions/auth, and the hooks it depends on. It is the contract between the page and the rest of the app.

**Why folders from the start:** a page that begins as one file inevitably grows a sub-row component, a derived-totals hook, a styles file. If the page is a file, those land in arbitrary places. If the page is a folder, they have an obvious home and the diff stays readable.

---

## 4. State: split by origin (non-negotiable, library-agnostic)

Two kinds of state, two homes. Mixing them is the most common architectural failure this skill exists to prevent. **The split is mandatory; the libraries are your choice.**

| State kind            | Examples                                                                          | Lives in                                                                                |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Server state**      | fetched entities, lists, aggregates — anything the API owns                       | a **query/cache layer** (e.g. TanStack Query, RTK Query, SWR, Apollo)                   |
| **UI / client state** | open dialogs, table filters/sort, wizard step, draft being typed, preview toggles | a **client store** (e.g. Zustand, Redux Toolkit, MobX, Jotai, Valtio, or React Context) |

### 4.1 Hard rules (independent of library)

- **Never mirror server responses into the client store.** No copying fetched entities into Zustand/Redux/MobX. The query/cache layer is the single source of truth for server data.
- **Never fetch inside components.** Components read server data from a data hook and UI state from a store selector. They don't call the network client directly.
- **Never drive continuous values through re-render state.** Scroll progress, pointer position, drag offset — use refs / animation values, not render state (it re-renders the tree every frame).
- **One store boundary per module.** Whatever library you use, give each module one cohesive store unit (a Zustand hook, a Redux slice, a MobX class, a Jotai atom group) accessed via the module barrel. Components subscribe to the smallest slice they need to avoid needless re-renders.

### 4.2 Choosing a client-state library — same shape, different syntax

Pick one per project and stay consistent. Each maps onto "one store unit per module" cleanly. Note the **`I` interface-naming convention**: state interfaces are prefixed with `I` (e.g. `IFeatureUiState`).

**Zustand** — `modules/{feature}/stores/{feature}.store.ts`

```ts
import { create } from "zustand";

export interface IFeatureUiState {
  isPreviewOpen: boolean;
  filter: string;
  togglePreview: () => void;
  setFilter: (filter: string) => void;
  reset: () => void;
}

const INITIAL_STATE = { isPreviewOpen: false, filter: "" } as const;

export const useFeatureUiStore = create<IFeatureUiState>()((set) => ({
  ...INITIAL_STATE,
  togglePreview: () => set((s) => ({ isPreviewOpen: !s.isPreviewOpen })),
  setFilter: (filter) => set({ filter }),
  reset: () => set({ ...INITIAL_STATE }),
}));
```

**Redux Toolkit** — `modules/{feature}/stores/{feature}.slice.ts` (registered in `shared/store/`)

```ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface IFeatureUiState {
  isPreviewOpen: boolean;
  filter: string;
}

const initialState: IFeatureUiState = { isPreviewOpen: false, filter: "" };

export const featureUiSlice = createSlice({
  name: "featureUi",
  initialState,
  reducers: {
    togglePreview: (s) => {
      s.isPreviewOpen = !s.isPreviewOpen;
    },
    setFilter: (s, action: PayloadAction<string>) => {
      s.filter = action.payload;
    },
    reset: () => initialState,
  },
});
```

**MobX** — `modules/{feature}/stores/{feature}.store.ts`

```ts
import { makeAutoObservable } from "mobx";

export interface IFeatureUiState {
  isPreviewOpen: boolean;
  filter: string;
}

export class FeatureUiStore implements IFeatureUiState {
  isPreviewOpen = false;
  filter = "";
  constructor() {
    makeAutoObservable(this);
  }
  togglePreview = () => {
    this.isPreviewOpen = !this.isPreviewOpen;
  };
  setFilter = (filter: string) => {
    this.filter = filter;
  };
  reset = () => {
    this.isPreviewOpen = false;
    this.filter = "";
  };
}
```

**Jotai** — `modules/{feature}/stores/{feature}.atoms.ts`

```ts
import { atom } from "jotai";
export const isPreviewOpenAtom = atom(false);
export const filterAtom = atom("");
```

> Whichever you choose, keep the rules in §4.1 constant. The skill cares that server and UI state are separated and that each module owns one store unit — not which library draws the box.

### 4.3 Data layer (server state)

All network access goes through **one typed client** in `shared/api-client/`. Modules wrap it in query/mutation hooks and a **key factory** so caches and invalidation stay consistent.

```ts
// modules/invoice/hooks/invoiceKeys.ts — hierarchical key factory (TanStack Query style)
export const invoiceKeys = {
  all: ["invoices"] as const,
  lists: () => [...invoiceKeys.all, "list"] as const,
  list: (params: IListParams) => [...invoiceKeys.lists(), params] as const,
  details: () => [...invoiceKeys.all, "detail"] as const,
  detail: (id: string) => [...invoiceKeys.details(), id] as const,
} as const;
```

Invalidating `lists()` refreshes every filter

…(the rest of this skill is left out)