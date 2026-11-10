// Shared daemon/extension wire framing. Node and MV3 use the same byte rules.
const FRAME_RESERVE_BYTES = 256;
const MAX_JSON_BYTES_PER_CHAR = 6;

/**
 * @param {string} requestId
 * @param {Record<string, unknown>} message
 * @param {number} maxFrameBytes
 * @returns {Record<string, unknown>[]}
 */
export function frameMessage(requestId, message, maxFrameBytes) {
  const json = JSON.stringify({ v: 1, ...message });
  if (
    new TextEncoder().encode(json).length + FRAME_RESERVE_BYTES <=
    maxFrameBytes
  )
    return [{ v: 1, ...message }];
  const budget = Math.max(
    1,
    Math.floor((maxFrameBytes - FRAME_RESERVE_BYTES) / MAX_JSON_BYTES_PER_CHAR),
  );
  const total = Math.max(1, Math.ceil(json.length / budget));
  /** @type {Record<string, unknown>[]} */
  const frames = [];
  for (let index = 0; index < total; index++)
    frames.push({
      v: 1,
      type: 'chunk',
      requestId,
      index,
      total,
      payload: json.slice(index * budget, (index + 1) * budget),
    });
  return frames;
}
