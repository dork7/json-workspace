# json-workspace

Multi-tab JSON editor with **Text** / **Tree** views, **Watch** path expressions (with suggestions), **Find**, and **Compare** (line-aligned diff). Built with **Next.js** (App Router) and React.

**Setup, prerequisites, and how to run locally:** see **[SETUP.md](./SETUP.md)**.

## View the website

| Environment | URL |
|-------------|-----|
| **Local development** | After `npm run dev` (or `yarn dev`), open **[http://localhost:3000](http://localhost:3000)** in your browser. |
| **Production (live)** | **[https://json-workspace.vercel.app/](https://json-workspace.vercel.app/)** |

## Scripts

- `npm run dev` — development server ([http://localhost:3000](http://localhost:3000))
- `npm run build` — production build
- `npm start` — run production server (after `build`)

## Layout

- `app/` — `layout.tsx`, `page.tsx`, `globals.css`
- `components/` — `JsonWorkspace.tsx` (main UI), `JsonTreeView.tsx`
- `lib/` — JSON parsing, paths, tab title derivation

The previous Express + static `public/` setup was replaced by this Next app.

## Deploy on Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In [Vercel](https://vercel.com), **Add New Project** → import the repo.
3. Vercel detects **Next.js**; leave defaults (root directory `.`, build `npm run build`, output handled by Next).
4. `vercel.json` sets `installCommand` to `npm ci` and `buildCommand` to `npm run build`. Node version follows `.nvmrc` (`20`) and `package.json` `engines`.

CLI: `npm i -g vercel` then `vercel` from the project root (links the project and deploys).

## Data on this device

- **Tabs** (content + names + which tab is active) are saved to `localStorage` under `json-workspace-workspace-v1` and restored after refresh.
- **Watch** expressions use `json-workspace-watch-v1`.
- **Closed tabs history** (restore / dismiss) uses `json-workspace-closed-tabs-v1`. Nothing is sent to a server; clearing site data removes it.
