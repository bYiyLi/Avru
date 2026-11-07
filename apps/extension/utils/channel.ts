import {
  channelPort,
  releaseChannel,
  type ReleaseChannel,
} from '../../../packages/protocol/environment.js';

declare const __AVRU_CHANNEL__: ReleaseChannel;

export function parseChannel(value: unknown): ReleaseChannel {
  if (value !== 'dev' && value !== 'prod')
    throw new Error('Avru build channel must be dev or prod');
  return value;
}

export function extensionChannel(): ReleaseChannel {
  return parseChannel(
    typeof __AVRU_CHANNEL__ === 'undefined'
      ? releaseChannel()
      : __AVRU_CHANNEL__,
  );
}

export function defaultEndpoint(): string {
  return `http://127.0.0.1:${String(channelPort(extensionChannel()))}`;
}
