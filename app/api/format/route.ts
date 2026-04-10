import { NextResponse } from 'next/server';
import prettier from 'prettier';

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
      const out = JSON.stringify(parsed, null, 2);
      return NextResponse.json({ ok: true as const, text: out });
    }
    const parser = lang === 'typescript' ? 'typescript' : 'babel';
    const out = await prettier.format(text, {
      parser: parser as 'typescript' | 'babel',
      semi: true,
      singleQuote: true,
    });
    return NextResponse.json({ ok: true as const, text: out });
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
