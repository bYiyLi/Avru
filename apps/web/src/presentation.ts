export type Language = 'zh' | 'en';
export function language(value: string): Language {
  return value.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export function translate(locale: Language, chinese: string, english: string) {
  return locale === 'zh' ? chinese : english;
}
export function browserGuide(agent: string) {
  if (/Edg\//.test(agent))
    return { name: 'Microsoft Edge', address: 'edge://extensions' };
  if (/Chrome\//.test(agent))
    return { name: 'Chrome', address: 'chrome://extensions' };
  return { name: '', address: '' };
}
export function versionStatus(actual?: string, expected?: string) {
  if (!actual || !expected) return 'unknown';
  return actual === expected ? 'match' : 'mismatch';
}
