import { detectTabLanguage } from '@/lib/detect-language';
import type { Tab, TabLanguage } from '@/lib/workspace-types';

export function getTabLang(tab: Tab): TabLanguage {
  if (tab.langAuto === false && tab.lang) return tab.lang;
  return detectTabLanguage(tab.text);
}
