import { NextRequest } from 'next/server';
import { cdpManager, resolvePageWsUrl } from '@/lib/cdp-manager';

export const runtime = 'nodejs';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export async function GET(req: NextRequest) {
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch { /* controller closed */ }
      };

      let wsUrl: string;
      try {
        wsUrl = await resolvePageWsUrl();
      } catch {
        send({ type: 'error', message: 'Chrome not reachable on port 9222' });
        controller.close();
        return;
      }

      try {
        await cdpManager.ensureConnected(wsUrl);
        await cdpManager.call('Runtime.enable');
        await cdpManager.call('Log.enable');
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'Connect failed' });
        controller.close();
        return;
      }

      send({ type: 'connected' });

      const off = cdpManager.on((method, params) => {
        if (method === 'Runtime.consoleAPICalled' || method === 'Log.entryAdded') {
          send({ type: 'log', method, params });
        }
      });

      req.signal.addEventListener('abort', () => {
        off();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
