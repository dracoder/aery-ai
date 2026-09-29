---
name: react
description: React component work in this project - hooks, state, effects, performance, error boundaries, TypeScript components. Enforces project conventions; defers API docs to context7.
---

# React Conventions

## Fetch live docs first

**Before writing any unfamiliar React API usage, fetch current docs via context7 MCP:**
call `mcp__context7__resolve-library-id` (e.g. "react", "react-router"), then the context7
docs query tool with the resolved id. Do NOT rely on memorized API signatures — this applies
to React APIs, Suspense/lazy, router APIs, and any third-party library. This skill covers
project conventions only, not API reference.

## Component structure

- Functional components only; no class components (sole exception: the shared `ErrorBoundary`).
- Named `export function ComponentName(...)`, PascalCase; hooks `useXxx`, camelCase.
- Every component gets a typed props interface (`ComponentNameProps`). `interface` for props,
  `type` for unions/intersections. No `any` — use `unknown` or proper types.
- Render order for async views: loading, then error, then empty/not-found, then data.

## State management

- `useState` for simple local state; group fields into one object only when they change together.
- `useReducer` with a discriminated-union `Action` type for multi-field async state
  (`data / loading / error`), not three parallel `useState` calls.
- Always update from previous state functionally:

```tsx
setFormData(prev => ({ ...prev, [name]: value }));
setCount(prev => prev + 1); // never setCount(count + 1) inside callbacks/intervals
```

## Effects

- List every dependency; never silence the exhaustive-deps lint.
- Every subscription/timer/fetch effect returns a cleanup. Guard async state updates:

```tsx
useEffect(() => {
  let cancelled = false;
  fetchUser(userId).then(u => { if (!cancelled) setUser(u); });
  return () => { cancelled = true; };
}, [userId]);
```

- Don't put fresh object/array literals in dependency arrays — memoize them or depend on
  the primitive values inside.

## Performance

- `useMemo` only for genuinely expensive computations; `useCallback` only for functions
  passed to memoized children. Don't memoize by default.
- Lazy-load heavy components and routes (`lazy` + `Suspense` with a fallback).
- List keys: stable unique ids, never the array index (index acceptable only for static,
  never-reordered lists without ids).

## Error handling

- Wrap lazy/data-driven subtrees: `<ErrorBoundary fallback={...}><Suspense fallback={<Loading />}>...`
  Use the shared `ErrorBoundary`; don't write new ones.

## Pitfalls to enforce in review

- Stale closures: functional updates inside intervals/callbacks (see snippet above).
- State reads right after `setState` — the value is not updated yet; react via effect or
  functional update instead.
- `dangerouslySetInnerHTML` needs justification and sanitized input; external links need
  `rel="noopener noreferrer"`; no secrets in client code.
- Forms: controlled inputs, per-field error state cleared on change, `aria-invalid` on
  invalid fields, labels/ARIA wired up.
