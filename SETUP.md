# Setup and run

This project is a **Next.js** app. You only need **Node.js** and a package manager—no database or extra services.

## Prerequisites

- **Node.js 20.x** (see `package.json` → `engines` and the `.nvmrc` file)

If you use [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install
nvm use
```

Check your version:

```bash
node -v   # should print v20.x.x
```

## 1. Get the project

Clone the repository (or download and extract it), then go into the project folder:

```bash
cd json-workspace
```

(Use your actual folder name if it differs.)

## 2. Install dependencies

From the project root:

```bash
npm install
```

If you prefer a clean install matching the lockfile (recommended for CI or reproducible builds):

```bash
npm ci
```

You can use **Yarn** or **pnpm** instead; install dependencies the way you usually do. This repo includes a `package-lock.json` for npm.

## 3. Run in development

```bash
npm run dev
```

Then open **[http://localhost:3000](http://localhost:3000)** in your browser.

The dev server watches files and reloads on change. Stop it with `Ctrl+C` in the terminal.

If port **3000** is busy, Next.js will suggest another port, or you can run:

```bash
npx next dev -p 3001
```

### Desktop app (Electron)

Run the same app in a **native window** instead of a separate browser tab.

**Development** — Next.js dev server plus Electron (port **3000**):

```bash
npm run electron:dev
```

**Production** — uses the Next.js **standalone** server bundled with the app (API routes work). After building, Electron starts a server on port **3050** and opens it:

```bash
npm run build
npm run electron
```

**Packaged installers** (output in `dist-electron/`):

```bash
npm run electron:pack
```

The production server is started with the Electron binary in Node mode (`ELECTRON_RUN_AS_NODE`), so end users do **not** need a separate Node.js install for the packaged app.

## 4. Production build and run

Build an optimized production bundle:

```bash
npm run build
```

Start the production server (must run `build` first):

```bash
npm start
```

By default the app is served at **[http://localhost:3000](http://localhost:3000)**.

## 5. Lint (optional)

```bash
npm run lint
```

## What you don’t need

- No `.env` file is required for local development.
- No database or Redis—editor state for tabs, watch list, and closed-tab history is stored in the **browser** (`localStorage`) on each device.

## Deploying

For **Vercel**, see the **Deploy on Vercel** section in [README.md](./README.md). The repo includes a `vercel.json` with install/build commands.

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| `Command not found: node` | Install Node 20.x from [nodejs.org](https://nodejs.org/) or use nvm. |
| Wrong Node version | Use Node 20.x (`nvm use` if you use nvm). |
| `EACCES` / permission errors installing packages | Avoid `sudo npm install`; fix npm permissions or use a Node version manager. |
| Port already in use | Stop the other process or use `npx next dev -p <port>`. |
| Blank page or errors after pull | Delete `node_modules` and `.next`, then `npm install` and `npm run dev` again. |

For project structure and features, see [README.md](./README.md).
