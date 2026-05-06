export type TabLanguage = 'json' | 'javascript' | 'typescript';

/** Bookmark anchored at UTF-16 offset of the first character of a line */
export type EditorBookmark = {
  id: string;
  anchor: number;
};

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
  /**
   * When `true`, the user has manually renamed this tab and content-driven
   * auto-naming should be left alone. Cleared if the user resets the name.
   */
  nameLocked?: boolean;
  /** Lines bookmarked in the text editor (per tab). */
  bookmarks?: EditorBookmark[];
};
