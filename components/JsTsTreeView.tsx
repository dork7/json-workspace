'use client';

import { PlainTreeView } from '@/components/JsonTreeView';
import { astToPlainObject } from '@/lib/ast-plain';
import { parseJsTs } from '@/lib/parse-js-ts';

export function JsTsTreeView({
  text,
  lang,
}: {
  text: string;
  lang: 'javascript' | 'typescript';
}) {
  const r = parseJsTs(text, lang);
  if (!r.ok) {
    return <div className="tree-error">Parse error: {r.error}</div>;
  }
  const plain = astToPlainObject(r.ast);
  return <PlainTreeView value={plain} />;
}
