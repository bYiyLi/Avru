import { releaseChannel } from '../../../packages/protocol/environment.js';

/** Compare only versions understood by the two compiled channels. */
export function compareVersions(
  candidate: string,
  installed: string,
): number | undefined {
  const parse = (value: string) =>
    /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/.exec(value);
  const left = parse(candidate);
  const right = parse(installed);
  if (!left || !right) return undefined;
  if (releaseChannel(candidate) !== releaseChannel(installed)) return undefined;
  for (let index = 1; index <= 4; index++) {
    const a = BigInt(left[index] ?? '0');
    const b = BigInt(right[index] ?? '0');
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}
