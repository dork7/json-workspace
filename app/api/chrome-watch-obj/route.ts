import { NextRequest, NextResponse } from 'next/server';
import { cdpManager } from '@/lib/cdp-manager';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { objectId } = (await req.json()) as { objectId?: string };
  if (!objectId) return NextResponse.json({ error: 'objectId required' }, { status: 400 });
  if (!cdpManager.isOpen()) return NextResponse.json({ error: 'Not connected' }, { status: 503 });

  try {
    // Assign object to a unique window variable so it can be referenced by name
    const varName = `__wf_${Date.now().toString(36)}`;
    await cdpManager.call('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() { window['${varName}'] = this; }`,
      returnByValue: true,
    });

    const propsResult = await cdpManager.call<{
      result: { name: string; enumerable?: boolean; value?: { type?: string } }[];
    }>('Runtime.getProperties', { objectId, ownProperties: true });

    const keys = (propsResult.result ?? [])
      .filter((p) => p.enumerable !== false)
      .map((p) => ({ name: p.name, type: p.value?.type ?? 'unknown' }));

    return NextResponse.json({ varName, keys });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
