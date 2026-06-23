import { NextRequest, NextResponse } from 'next/server';
import { cdpManager } from '@/lib/cdp-manager';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { objectId?: string };
  if (!body.objectId) {
    return NextResponse.json({ error: 'objectId required' }, { status: 400 });
  }

  if (!cdpManager.isOpen()) {
    return NextResponse.json(
      { error: 'No active CDP session. Connect via Chrome Logs first.' },
      { status: 503 }
    );
  }

  try {
    const result = await cdpManager.call<{ result: unknown[] }>('Runtime.getProperties', {
      objectId: body.objectId,
      ownProperties: true,
    });
    return NextResponse.json({ properties: result.result ?? [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to get properties' },
      { status: 500 }
    );
  }
}
