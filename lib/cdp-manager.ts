import WebSocket from 'ws';

type Listener = (method: string, params: unknown) => void;

class CdpManager {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private connectingPromise: Promise<void> | null = null;

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async ensureConnected(wsUrl: string): Promise<void> {
    if (this.isOpen()) return;
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this._connect(wsUrl).finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  private _connect(wsUrl: string): Promise<void> {
    this.ws?.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.on('open', () => resolve());

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as {
            id?: number;
            method?: string;
            params?: unknown;
            result?: unknown;
            error?: { message: string };
          };
          if (msg.id != null) {
            const cb = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (cb) {
              if (msg.error) cb.reject(new Error(msg.error.message));
              else cb.resolve(msg.result);
            }
          } else if (msg.method) {
            for (const fn of this.listeners) fn(msg.method, msg.params);
          }
        } catch { /* ignore malformed */ }
      });

      ws.on('close', () => {
        this.ws = null;
        for (const [, cb] of this.pending) cb.reject(new Error('CDP session closed'));
        this.pending.clear();
      });

      ws.on('error', (err) => reject(err));
    });
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.isOpen()) return Promise.reject(new Error('CDP not connected'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

// Survive HMR in Next.js dev mode
declare global { var __cdpManager: CdpManager | undefined }
export const cdpManager = (globalThis.__cdpManager ??= new CdpManager());

export async function resolvePageWsUrl(): Promise<string> {
  const res = await fetch('http://localhost:9222/json');
  const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page found in Chrome');
  return page.webSocketDebuggerUrl;
}
