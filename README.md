# Watchfox

Multi-tab workspace for **JSON**, **JavaScript**, and **TypeScript**: edit with syntax highlighting, evaluate **watch** paths against the buffer, **find** matches, **bookmark** lines, **fold** large structures, and **compare** tabs side by side. Built with **Next.js** (App Router), **React**, and **CodeMirror 6**.

**Setup, prerequisites, and how to run locally:** see **[SETUP.md](./SETUP.md)**.

## Features

### Editor

- **Tabs** — Multiple buffers per workspace; tab labels derive from content when possible (e.g. JSON root keys).
- **Language** — Auto-detect JSON vs JS/TS, or pin a language from the toolbar.
- **CodeMirror 6** — Syntax highlighting, bracket matching, fold gutter (▼/▶), line numbers, soft wrapping.
- **Format / Minify** — Toolbar actions call `/api/format` and `/api/minify` (server-side Prettier/esbuild-style transforms depending on language).

### Find

- Toolbar **Find** field with **Prev** / **Next** (also **Enter** / **Shift+Enter**).
- **⌘F / Ctrl+F** focuses Find and switches away from Compare view when open.
- Matches use the editor selection with a **yellow highlight** (`drawSelection`) for visibility.

### Bookmarks

- **Click a line number** to toggle a bookmark on that line (number turns **red** when active).
- **F9** toggles a bookmark on the caret line.
- Bookmarks appear as pills above the editor with line preview; remove individually or **Clear all**.

### Watch

- Watch expressions are paths from the document root (e.g. `user`, `items[0]`, `["key-name"]`).
- **Suggestions** come from JSON paths or JS/TS AST paths when the buffer parses.
- **Add** from the sidebar input or click **+** in the gutter on a line (infers path from JSON keys or declarations / identifiers).
- **Clear all** removes every watch expression at once.
- Values update when the active tab text changes; invalid JSON/JS/TS shows parse errors per expression where relevant.

### Folding

- **Collapse all** / **Expand all** run CodeMirror **foldAll** / **unfoldAll** on the active editor (syntax-aware folds).

### Compare

- Pick **Tab A** and **Tab B** in the sidebar, then **Show diff side by side** — line-aligned differing lines only.

### Notifications

- Errors (format/minify failures, watch gutter inference issues, duplicate watches) use **[Sonner](https://sonner.emilkowal.ski/)** toasts (**bottom-center**, dark theme), not blocking `alert()` dialogs.

### History & persistence

- **Closed tabs** can be restored from the sidebar History panel.
- See **[Data on this device](#data-on-this-device)** for `localStorage` keys (tabs, watches, closed-tab history). Nothing is sent to Watchfox servers for editor content unless you call the format/minify APIs.

### Desktop (optional)

- **Electron** scripts in `package.json` (`electron`, `electron:dev`, `electron:pack`) wrap the Next app for a desktop shell when configured.

## View the website

| Environment | URL |
|-------------|-----|
| **Local development** | After `npm run dev` (or `yarn dev`), open **[http://localhost:3000](http://localhost:3000)** in your browser. |
| **Production (live)** | **[https://json-workspace.vercel.app/](https://json-workspace.vercel.app/)** (deployment name may still match the previous project) |

You can also copy the URLs as plain text:

```text
http://localhost:3000
https://json-workspace.vercel.app/
```

## Scripts

- `npm run dev` — development server ([http://localhost:3000](http://localhost:3000))
- `npm run build` — production build
- `npm start` — run production server (after `build`)

## Project layout

- `app/` — App Router (`layout.tsx`, `page.tsx`), global styles, API routes under `app/api/`
- `components/` — `JsonWorkspace.tsx` (main shell), `WorkspaceEditor.tsx` (CodeMirror), `SonnerToaster.tsx`
- `lib/` — parsing, JSON paths, tab naming, CodeMirror gutters (bookmarks / watch), workspace storage helpers

The older Express + static `public/` setup was replaced by this Next app.

## Deploy on Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In [Vercel](https://vercel.com), **Add New Project** → import the repo.
3. Vercel detects **Next.js**; leave defaults (root directory `.`, build `npm run build`, output handled by Next).
4. `vercel.json` sets `installCommand` to `npm ci` and `buildCommand` to `npm run build`. Node version follows `.nvmrc` (`20`) and `package.json` `engines`.

CLI: `npm i -g vercel` then `vercel` from the project root (links the project and deploys).

## Data on this device

- **Tabs** (content + names + which tab is active, plus bookmarks per tab) are saved to `localStorage` under `watchfox-workspace-v1` and restored after refresh. Data under the older `json-workspace-workspace-v1` key is migrated once on load.
- **Watch** expressions use `watchfox-watch-v1` (migrated from `json-workspace-watch-v1`).
- **Closed tabs history** (restore / dismiss) uses `watchfox-closed-tabs-v1` (migrated from `json-workspace-closed-tabs-v1`). Nothing is sent to a server for this local state; clearing site data removes it.
