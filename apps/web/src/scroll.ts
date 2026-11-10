export const INSTALL_VERSION_ANCHOR = 'install-version';
export function scrollToSection(id: string): boolean {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return false;
  const target = doc.getElementById(id);
  if (!target) return false;
  target.scrollIntoView();
  return true;
}
