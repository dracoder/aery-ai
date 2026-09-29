---
name: nextjs
description: Use when writing or reviewing Next.js App Router code - pages, layouts, Server/Client Components, Server Actions, route handlers, data fetching, caching.
---

# Next.js Project Conventions

## Docs: use context7, not memory

Before writing any Next.js code you are not 100% sure about (new APIs, caching semantics, config options, version-specific behavior), fetch current docs via the context7 MCP server: call `mcp__context7__resolve-library-id` with "next.js", then query the docs tool for the specific topic. Next.js changes fast between majors; do not trust training data for API signatures or caching defaults.

## Server vs Client Components

- App Router only. Everything is a Server Component by default; add `'use client'` only for event handlers, hooks (`useState`, `useEffect`, ...), or browser APIs.
- Keep Client Components small, leaf-level, and focused on interactivity. Fetch data in Server Components and pass it down as props.
- `'use client'` marks a boundary: everything it imports becomes client code. Never import a Server Component into a Client Component directly - pass it as `children`:

```tsx
// CORRECT - server content stays server-rendered
'use client';
export function ClientWrapper({ children }: { children: React.ReactNode }) {
  return <div onClick={handleClick}>{children}</div>;
}
```

## Routing conventions

- Standard App Router files per segment: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx` (must be `'use client'`), `not-found.tsx`, `api/**/route.ts`.
- Use route groups `(name)/` for organization without URL segments (e.g. `(auth)/login`).
- Co-locate a route's private Client Components in its segment folder (e.g. `app/posts/[id]/interactive-buttons.tsx`).
- `params` and `searchParams` are Promises - always await them:

```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}
```

## Data fetching and mutations

- Fetch in async Server Components; pick caching explicitly per call: default cached, `{ cache: 'no-store' }` for per-request data, `{ next: { revalidate: N } }` for time-based revalidation. Verify current-version caching defaults via context7 - they changed between Next 14 and 15.
- Prefer Server Actions (`'use server'`) over API routes for form mutations; validate all input and call `revalidatePath`/`revalidateTag` after writes:

```tsx
'use server';
import { revalidatePath } from 'next/cache';

export async function createPost(formData: FormData) {
  // validate input first
  await db.posts.create({ data: { title: formData.get('title') } });
  revalidatePath('/posts');
}
```

- Reserve `route.ts` handlers for external/API consumers; return `NextResponse.json` with explicit status codes.

## Pitfalls to enforce

- Secrets only in non-`NEXT_PUBLIC_` env vars; `NEXT_PUBLIC_*` is shipped to the browser.
- Wrap slow async subtrees in Suspense / `loading.tsx` for streaming.
- Use `next/image` and `next/font` - no raw `<img>` or `<link>` font tags.
- Add `generateMetadata` (or static `metadata`) on public pages for SEO.
- Server Actions and route handlers must check auth/authorization themselves - middleware alone is not sufficient.
