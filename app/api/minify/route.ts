import { NextResponse } from 'next/server';
import * as esbuild from 'esbuild';

export const runtime = 'nodejs';

type Body = { text?: string; lang?: 'json' | 'javascript' | 'typescript' };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text : '';
  const lang = body.lang ?? 'json';

  try {
    if (lang === 'json') {
      const parsed = JSON.parse(text);
      const out = JSON.stringify(parsed);
      return NextResponse.json({ ok: true as const, text: out });
    }
    const loader = lang === 'typescript' ? 'ts' : 'js';
    const result = await esbuild.transform(text, {
      loader,
      minify: true,
      legalComments: 'none',
    });
    return NextResponse.json({ ok: true as const, text: result.code });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 422 }
    );
  }
}
