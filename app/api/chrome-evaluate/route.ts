import { NextRequest, NextResponse } from 'next/server';
import { cdpManager } from '@/lib/cdp-manager';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { expression } = (await req.json()) as { expression?: string };
  if (!expression) return NextResponse.json({ error: 'expression required' }, { status: 400 });

  if (!cdpManager.isOpen()) {
    return NextResponse.json({ error: 'Not connected — open Chrome Logs first.' }, { status: 503 });
  }

  try {
    const result = await cdpManager.call<{
      result: unknown;
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', {
      expression,
      returnByValue: false,
      generatePreview: true,
      includeCommandLineAPI: true,
    });

    if (result.exceptionDetails) {
      const msg =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Exception';
      return NextResponse.json({ error: msg });
    }

    return NextResponse.json({ result: result.result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Evaluation failed' },
      { status: 500 }
    );
  }
}
