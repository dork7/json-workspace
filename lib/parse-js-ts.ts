import { parse, type ParserOptions } from '@babel/parser';

export function parseJsTs(
  text: string,
  lang: 'javascript' | 'typescript'
): { ok: true; ast: ReturnType<typeof parse> } | { ok: false; error: string } {
  try {
    const plugins: NonNullable<ParserOptions['plugins']> =
      lang === 'typescript' ? ['typescript', 'jsx'] : ['jsx'];
    const ast = parse(text, {
      sourceType: 'unambiguous',
      allowImportExportEverywhere: true,
      errorRecovery: true,
      plugins,
    });
    return { ok: true, ast };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
