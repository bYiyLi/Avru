import { expect, it } from 'vitest';
import { browserMetadata } from '../utils/metadata';
it('uses full client hints where known, labels reduced UA fallback and tolerates privacy refusal', async () => {
  const ua = { userAgent: 'Chrome/140.0.0.0 Edg/140.0.1.2' };
  expect(await browserMetadata(ua, '0.0.1')).toMatchObject({
    browserName: 'Microsoft Edge',
    browserVersion: '140.0.1.2',
    versionSource: 'userAgent',
  });
  expect(
    await browserMetadata({ userAgent: 'Chrome/140.0.0.0' }, '0.0.1'),
  ).toMatchObject({ browserName: 'Chrome', versionSource: 'userAgent' });
  expect(
    await browserMetadata({ userAgent: 'unknown' }, '0.0.1'),
  ).toMatchObject({
    browserName: 'Unknown',
    browserVersion: 'Unknown',
    versionSource: 'unknown',
  });
  const values = () =>
    Promise.resolve({
      fullVersionList: [{ brand: 'Google Chrome', version: '140.0.1.9' }],
    });
  expect(
    await browserMetadata(
      { ...ua, userAgentData: { getHighEntropyValues: values } },
      '0.0.1',
    ),
  ).toMatchObject({
    browserName: 'Google Chrome',
    browserVersion: '140.0.1.9',
    versionSource: 'clientHints',
  });
  for (const list of [
    undefined,
    [],
    [{ brand: 'Microsoft Edge', version: 'bad' }],
    [{ brand: 'Chromium', version: '140.1' }],
  ]) {
    expect(
      (
        await browserMetadata(
          {
            ...ua,
            userAgentData: {
              getHighEntropyValues: () =>
                Promise.resolve(list ? { fullVersionList: list } : {}),
            },
          },
          '0.0.1',
        )
      ).versionSource,
    ).toBe('userAgent');
  }
  expect(
    (
      await browserMetadata(
        {
          ...ua,
          userAgentData: {
            getHighEntropyValues: () =>
              Promise.resolve({
                fullVersionList: [
                  { brand: 'Microsoft Edge', version: '140.1' },
                ],
              }),
          },
        },
        '0.0.1',
      )
    ).versionSource,
  ).toBe('clientHints');
  expect(
    (
      await browserMetadata(
        {
          ...ua,
          userAgentData: {
            getHighEntropyValues: () => Promise.reject(new Error('Denied')),
          },
        },
        '0.0.1',
      )
    ).versionSource,
  ).toBe('userAgent');
});
