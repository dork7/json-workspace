export type TabLanguage = 'json' | 'javascript' | 'typescript';

export type Tab = {
  id: string;
  name: string;
  text: string;
  /** Used when `langAuto === false`. */
  lang?: TabLanguage;
  /**
   * When not `false`, language is inferred from content.
   * Omitted or `true` = auto-detect (default). `false` = use `lang` only.
   */
  langAuto?: boolean;
};
