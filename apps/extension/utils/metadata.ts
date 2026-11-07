export interface Metadata {
  browserName: string;
  browserVersion: string;
  versionSource: 'clientHints' | 'userAgent' | 'unknown';
  extensionVersion: string;
}
interface ClientHints {
  getHighEntropyValues(hints: string[]): Promise<{
    fullVersionList?: { brand: string; version: string }[];
  }>;
}
export interface BrowserEnvironment {
  userAgent: string;
  userAgentData?: ClientHints;
}
export async function browserMetadata(
  environment: BrowserEnvironment,
  extensionVersion: string,
): Promise<Metadata> {
  const match =
    /(Edg)\/([\d.]+)/.exec(environment.userAgent) ??
    /(Chrome)\/([\d.]+)/.exec(environment.userAgent);
  const result: Metadata = {
    browserName:
      match?.[1] === 'Edg' ? 'Microsoft Edge' : match ? 'Chrome' : 'Unknown',
    browserVersion: match?.[2] ?? 'Unknown',
    versionSource: match ? 'userAgent' : 'unknown',
    extensionVersion,
  };
  // UA may be reduced; only a known vendor's fullVersionList is labelled clientHints.
  try {
    const hints = await environment.userAgentData?.getHighEntropyValues([
      'fullVersionList',
    ]);
    const brands = hints?.fullVersionList;
    const brand =
      brands?.find((item) => item.brand === 'Microsoft Edge') ??
      brands?.find((item) => item.brand === 'Google Chrome');
    if (brand && /^[\d.]{1,64}$/.test(brand.version)) {
      result.browserName = brand.brand;
      result.browserVersion = brand.version;
      result.versionSource = 'clientHints';
    }
  } catch {
    // Permission/privacy refusal does not turn a usable connection into a failure.
  }
  return result;
}
