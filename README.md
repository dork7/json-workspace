# json-workspace

Multi-tab JSON editor with **Text** / **Tree** views, **Watch** path expressions (with suggestions), **Find**, and **Compare** (line-aligned diff). Built with **Next.js** (App Router) and React.

## Scripts

- `npm run dev` — development server ([http://localhost:3000](http://localhost:3000))
- `npm run build` — production build
- `npm start` — run production server (after `build`)

## Layout

- `app/` — `layout.tsx`, `page.tsx`, `globals.css`
- `components/` — `JsonWorkspace.tsx` (main UI), `JsonTreeView.tsx`
- `lib/` — JSON parsing, paths, tab title derivation

The previous Express + static `public/` setup was replaced by this Next app.
