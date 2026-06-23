import { NextRequest, NextResponse } from 'next/server';
import { cdpManager } from '@/lib/cdp-manager';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { objectId } = (await req.json()) as { objectId?: string };
  if (!objectId) return NextResponse.json({ error: 'objectId required' }, { status: 400 });
  if (!cdpManager.isOpen()) return NextResponse.json({ error: 'Not connected' }, { status: 503 });

  try {
    const result = await cdpManager.call<{ result: { value?: string } }>(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration:
          'function() { try { return JSON.stringify(this, null, 2); } catch(e) { return String(this); } }',
        returnByValue: true,
      }
    );
    return NextResponse.json({ json: result.result?.value ?? '' });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
