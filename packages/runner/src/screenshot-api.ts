/** Bounded JPEG screenshot capture through the full CDP browser bridge. */
export const SCREENSHOT_API_SOURCE = String.raw`(() => {
  function installScreenshotApi(tab) {
  const cdp = tab.cdp;
  function bad(message) {
    throw new SdkError('INVALID_ARGUMENT', message);
  }
  function rectangle(value) {
    if (!value || typeof value !== 'object' ||
        !Number.isFinite(value.x) || value.x < 0 ||
        !Number.isFinite(value.y) || value.y < 0 ||
        !Number.isFinite(value.width) || value.width <= 0 ||
        !Number.isFinite(value.height) || value.height <= 0)
      bad('screenshot clip must be a positive CSS-pixel rectangle');
    return {
      x: value.x, y: value.y, width: value.width, height: value.height
    };
  }
  async function screenshot(options) {
    if (options === undefined) options = {};
    if (!options || typeof options !== 'object' || Array.isArray(options))
      bad('screenshot options must be an object');
    const quality = options.quality === undefined ? 80 : options.quality;
    const maxEdgePx = options.maxEdgePx === undefined ? 1920 : options.maxEdgePx;
    const fullPage = options.fullPage === true;
    if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100)
      bad('screenshot quality must be an integer between 1 and 100');
    if (!Number.isSafeInteger(maxEdgePx) || maxEdgePx < 64 || maxEdgePx > 1920)
      bad('screenshot maxEdgePx must be 64..1920');
    if (options.fullPage !== undefined && typeof options.fullPage !== 'boolean')
      bad('screenshot fullPage must be boolean');
    if (fullPage && options.clip !== undefined)
      bad('screenshot fullPage cannot be combined with clip');
    const userClip = options.clip === undefined ? null : rectangle(options.clip);
    const metrics = await cdp.send('Page.getLayoutMetrics', {});
    const viewport = fullPage ? metrics && metrics.cssContentSize :
      metrics && (metrics.cssVisualViewport || metrics.cssLayoutViewport);
    if (!viewport)
      throw new SdkError('PAGE_NOT_ACCESSIBLE', 'layout metrics unavailable');
    const bounds = userClip || rectangle({
      x: fullPage ? 0 : (viewport.pageX || 0),
      y: fullPage ? 0 : (viewport.pageY || 0),
      width: viewport.clientWidth || viewport.width,
      height: viewport.clientHeight || viewport.height
    });
    let scale = Math.min(1, maxEdgePx / Math.max(bounds.width, bounds.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const capture = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality,
        captureBeyondViewport: fullPage,
        clip: { ...bounds, scale }
      });
      if (!capture || typeof capture.data !== 'string' ||
          !capture.data.startsWith('/9j/'))
        throw new SdkError('PAGE_NOT_ACCESSIBLE', 'Chrome did not return JPEG data');
      // The private runner bridge handles at most 64 KiB per JSON result.
      // Keep the documented quality and reduce dimensions only when required
      // to fit the actual transport budget.
      if (capture.data.length <= 48 * 1024)
        return { data: capture.data, mimeType: 'image/jpeg' };
      scale *= 0.75;
    }
    throw new SdkError('OUTPUT_TOO_LARGE', 'JPEG exceeds the inline IPC limit after bounded downscaling');
  }
  tab.screenshot = screenshot;
  }
  Object.defineProperty(globalThis, '__avruInstallScreenshotApi', { value: installScreenshotApi });
})()`;
