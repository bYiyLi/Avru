export type ReleaseChannel = 'dev' | 'prod';
export const RELEASE_VERSION: string;
export function releaseChannel(version?: string): ReleaseChannel;
export function channelPort(channel: ReleaseChannel): number;
export function extensionId(channel: ReleaseChannel): string;
