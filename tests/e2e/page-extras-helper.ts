import { expect, type Page } from '@playwright/test';

type RemoteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export async function verifyPageExtras(
  call: RemoteTool,
  tab: Page,
  browserId: string,
  tabId: number,
) {
  // Test setup only: actual hover, option selection and resizing are done by Avru.
  await tab.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'size';
    select.setAttribute('aria-label', 'Size');
    for (const [value, label] of [
      ['small', 'Small'],
      ['medium', 'Medium'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    const hovered = document.createElement('output');
    hovered.id = 'hovered';
    const chosen = document.createElement('output');
    chosen.id = 'choice';
    select.addEventListener('mouseover', () => {
      hovered.textContent = 'hovered';
    });
    select.addEventListener('change', () => {
      chosen.textContent = select.value;
    });
    document.body.append(select, hovered, chosen);
  });
  const task = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script: `
      const original = await browser.tab.snapshot();
      const first = original.root.children.find(node =>
        node.role === 'combobox' && node.name === 'Size'
      );
      await browser.tab.hover(first.ref);
      const refreshed = await browser.tab.snapshot();
      const next = refreshed.root.children.find(node =>
        node.role === 'combobox' && node.name === 'Size'
      );
      await browser.tab.selectOption(next.ref, {label:'Medium'});
      await browser.tab.setViewport({width:800,height:600});
      const observed = await browser.tab.evaluate(
        '({width:innerWidth,size:document.querySelector("#size").value})'
      );
      await browser.tab.cdp.send('Emulation.clearDeviceMetricsOverride',{});
      return observed;
    `,
  });
  let observed: unknown;
  await expect
    .poll(
      async () => {
        const state = await call('browser_get_execution', {
          executionId: task.executionId,
        });
        observed = state.result;
        return state.state;
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
  expect(observed).toEqual({ width: 800, size: 'medium' });
  await expect(tab.locator('#hovered')).toHaveText('hovered');
  await expect(tab.locator('#choice')).toHaveText('medium');
}
