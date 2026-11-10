export type Language = 'zh' | 'en';
export function language(value: string): Language {
  return value.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export function versionStatus(actual?: string, expected?: string) {
  if (!actual || !expected) return 'unknown';
  return actual === expected ? 'match' : 'mismatch';
}
