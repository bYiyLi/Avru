import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES } from '../src/sdk';

const viewport = {
  cssVisualViewport: {
    pageX: 0,
    pageY: 0,
    clientWidth: 1280,
    clientHeight: 720,
  },
  cssContentSize: {
    x: 0,
    y: 0,
    width: 1280,
    height: 2500,
  },
};

function bridge(image = '/9j/AAAAAA==', layout: unknown = viewport) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const invoke = vi.fn((method: string, json: string) => {
    expect(method).toBe('cdp.send');
    const [command, args] = JSON.parse(json) as [
      string,
      Record<string, unknown>,
    ];
    calls.push({ method: command, args });
    const value =
      command === 'Page.getLayoutMetrics' ? layout : { data: image };
    return Promise.resolve(JSON.stringify(value));
  });
  return { invoke, calls };
}

describe('bounded screenshot over the browser CDP bridge', () => {
  it('captures a JPEG with bounded viewport scale and documented MIME type', async () => {
    const h = bridge();
    const result = await execute(
      'return await browser.tab.screenshot();',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: JSON.stringify({
        data: '/9j/AAAAAA==',
        mimeType: 'image/jpeg',
      }),
    });
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0]).toEqual({
      method: 'Page.getLayoutMetrics',
      args: {},
    });
    expect(h.calls[1]).toEqual({
      method: 'Page.captureScreenshot',
      args: {
        format: 'jpeg',
        quality: 80,
        captureBeyondViewport: false,
        clip: {
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
          scale: 1,
        },
      },
    });
  });

  it('captures a bounded full-page JPEG from the content size', async () => {
    const h = bridge();
    const result = await execute(
      'return await browser.tab.screenshot({fullPage:true,maxEdgePx:320,quality:45});',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    expect(h.calls[1]).toEqual({
      method: 'Page.captureScreenshot',
      args: {
        format: 'jpeg',
        quality: 45,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: 1280,
          height: 2500,
          scale: 320 / 2500,
        },
      },
    });
  });

  it('honors the user clip dimensions without exceeding the max edge', async () => {
    const h = bridge();
    const result = await execute(
      'return await browser.tab.screenshot({' +
        'quality:40,maxEdgePx:256,clip:{x:5,y:8,width:400,height:200}});',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    expect(h.calls[1]?.args).toMatchObject({
      quality: 40,
      clip: { x: 5, y: 8, width: 400, height: 200, scale: 256 / 400 },
    });
  });

  it('rejects malformed screenshot settings before host dispatch', async () => {
    const h = bridge();
    const result = await execute(
      'const bad=[null,{quality:0},{quality:101},{maxEdgePx:1},' +
        '{maxEdgePx:9999},{fullPage:"yes"},' +
        '{fullPage:true,clip:{x:0,y:0,width:20,height:20}},' +
        '{clip:{x:-1,y:0,width:3,height:4}},' +
        '{clip:{x:0,y:0,width:0,height:4}}];' +
        'for(const opt of bad){try{await browser.tab.screenshot(opt);' +
        'return "unexpected";}catch(e){if(e.code!=="INVALID_ARGUMENT")' +
        'return e.code;}}return "validated";',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"validated"' });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('does not claim success when Chrome lacks layout metrics', async () => {
    const h = bridge('/9j/AAAAAA==', {});
    const result = await execute(
      'try{await browser.tab.screenshot();return "unexpected";}' +
        'catch(e){return e.code;}',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '"PAGE_NOT_ACCESSIBLE"',
    });
    expect(h.calls).toHaveLength(1);
  });

  it('does not accept a non-JPEG CDP response', async () => {
    const h = bridge('iVBORw0KGgo=');
    const result = await execute(
      'try{await browser.tab.screenshot();return "unexpected";}' +
        'catch(e){return e.code;}',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '"PAGE_NOT_ACCESSIBLE"',
    });
  });

  it('rejects JPEG bytes that exceed the inline runner IPC limit', async () => {
    const h = bridge('/9j/' + 'A'.repeat(49 * 1024));
    const result = await execute(
      'try{await browser.tab.screenshot();return "unexpected";}' +
        'catch(e){return e.code;}',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"OUTPUT_TOO_LARGE"' });
  });

  it('advertises bounded screenshot capture to AI without implying large-image delivery', () => {
    expect(
      SDK_CAPABILITIES.find(
        (capability) => capability.name === 'tab.screenshot',
      ),
    ).toMatchObject({ supported: true });
  });
});
