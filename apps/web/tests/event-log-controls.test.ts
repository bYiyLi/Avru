import { createElement, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import {
  EventLogFilters,
  EventLogFooter,
  EventLogPagination,
} from '../src/EventLogControls.js';
import type { EventFilterState } from '../src/EventLogControls.js';

interface ElementProps {
  type?: string;
  value?: unknown;
  disabled?: boolean;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  onClick?: () => void;
  children?: ReactNode;
}

function elements(node: ReactNode): ElementProps[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  const child = node.props.children;
  if (typeof node.type === 'function')
    return [
      node.props,
      ...elements(
        (node.type as (props: ElementProps) => ReactNode)(node.props),
      ),
    ];
  return [node.props, ...elements(child)];
}

const filters: EventFilterState = {
  query: 'trace-a',
  outcome: 'failed',
  stage: 'dispatch',
  event: 'dispatch.failed',
  timeRange: '1h',
};

it('renders every event filter and forwards the selected filter values', () => {
  const onChange = vi.fn();
  const view = EventLogFilters({
    filters,
    codes: ['authorization.denied', 'dispatch.failed'],
    locale: 'en',
    onChange,
  });
  const html = renderToStaticMarkup(createElement(() => view));
  expect(html).toContain('Search events');
  expect(html).toContain('dispatch.failed');
  expect(html).toContain('Past hour');
  const controls = elements(view).filter((props) => props.onChange);
  const search = controls.find((props) => props.type === 'search');
  const selects = controls.filter((props) => props.value !== undefined);
  search?.onChange?.({ currentTarget: { value: 'request-1' } });
  for (const select of selects)
    select.onChange?.({ currentTarget: { value: 'all' } });
  expect(onChange).toHaveBeenCalledWith('query', 'request-1');
  expect(onChange).toHaveBeenCalledWith('outcome', 'all');
  expect(onChange).toHaveBeenCalledWith('stage', 'all');
  expect(onChange).toHaveBeenCalledWith('event', 'all');
  expect(onChange).toHaveBeenCalledWith('timeRange', 'all');
});

it('renders unavailable footer controls as disabled and keeps the page boundary', () => {
  const onExport = vi.fn();
  const onCopy = vi.fn();
  const onPage = vi.fn();
  const view = EventLogFooter({
    locale: 'zh',
    available: false,
    shown: 0,
    total: 0,
    page: 1,
    pages: 1,
    notice: '',
    onExport,
    onCopy,
    onPage,
  });
  const html = renderToStaticMarkup(createElement(() => view));
  expect(html).toContain('记录不可用');
  expect(html).toContain('未知');
  const buttons = elements(view).filter((props) => props.type === 'button');
  expect(buttons).toHaveLength(4);
  expect(buttons.every((button) => button.disabled === true)).toBe(true);
  expect(onExport).not.toHaveBeenCalled();
  expect(onCopy).not.toHaveBeenCalled();
  expect(onPage).not.toHaveBeenCalled();
});

it('renders every operation notice and invokes available export and copy actions', () => {
  for (const [notice, label] of [
    ['exported', '事件记录已下载'],
    ['copied', '诊断摘要已复制'],
    ['copyFailed', '无法复制'],
  ] as const) {
    const onExport = vi.fn();
    const onCopy = vi.fn();
    const onPage = vi.fn();
    const view = EventLogFooter({
      locale: 'zh',
      available: true,
      shown: 3,
      total: 8,
      page: 2,
      pages: 3,
      notice,
      onExport,
      onCopy,
      onPage,
    });
    const html = renderToStaticMarkup(createElement(() => view));
    expect(html).toContain(label);
    expect(html).toContain('3 / 8 条事件');
    const buttons = elements(view).filter((props) => props.type === 'button');
    expect(buttons).toHaveLength(4);
    buttons[0]?.onClick?.();
    buttons[1]?.onClick?.();
    expect(onExport).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(buttons.every((button) => button.disabled !== true)).toBe(true);
  }
});

it('disables previous and next pagination at the respective boundaries', () => {
  const onPage = vi.fn();
  const first = EventLogPagination({
    locale: 'en',
    page: 1,
    pages: 3,
    onPage,
  });
  const firstButtons = elements(first).filter(
    (props) => props.type === 'button',
  );
  expect(firstButtons[0]?.disabled).toBe(true);
  expect(firstButtons[1]?.disabled).toBe(false);
  firstButtons[1]?.onClick?.();
  expect(onPage).toHaveBeenCalledWith(2);

  const last = EventLogPagination({
    locale: 'en',
    page: 3,
    pages: 3,
    onPage,
  });
  const lastButtons = elements(last).filter((props) => props.type === 'button');
  expect(lastButtons[0]?.disabled).toBe(false);
  expect(lastButtons[1]?.disabled).toBe(true);
  lastButtons[0]?.onClick?.();
  expect(onPage).toHaveBeenLastCalledWith(2);
});
