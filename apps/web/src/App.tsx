import { useEffect, useSyncExternalStore } from 'react';
import type { Controller, ViewState } from './controller.js';

export function Dashboard({
  state,
  approve,
  reject,
  revoke,
}: {
  state: ViewState;
  approve: (id: string) => void;
  reject: (id: string) => void;
  revoke: (id: string) => void;
}) {
  return (
    <main>
      <p>Avru · 本机管理</p>
      <h1>浏览器控制工作台</h1>
      <p>
        连接本机浏览器，查看已配对的浏览器配置与标签页。此阶段不提供远程 MCP
        或网页操作。
      </p>
      {state.message && <p role="status">{state.message}</p>}
      {!state.authorized ? (
        <p>请重新打开守护进程启动时提供的管理链接。</p>
      ) : (
        <>
          <p>
            请在浏览器扩展中点击连接，再在此核对并批准请求。无需输入或复制凭据。
          </p>
          {state.pairings.map((pairing) => (
            <section key={pairing.id} aria-label="配对请求">
              <h2>{pairing.name} 请求配对</h2>
              <p>
                核对扩展弹窗与此处的六位码完全一致，再批准。不要批准不认识的请求。
              </p>
              <code>{pairing.code}</code>
              <p>扩展来源：{pairing.origin}</p>
              <p>有效期至 {new Date(pairing.expiresAt).toLocaleTimeString()}</p>
              <button
                disabled={state.busy}
                onClick={() => {
                  approve(pairing.id);
                }}
              >
                核对一致，批准配对
              </button>
              <button
                disabled={state.busy}
                onClick={() => {
                  reject(pairing.id);
                }}
              >
                拒绝请求
              </button>
            </section>
          ))}
          {!state.browsers.length && (
            <p>尚未连接浏览器，请先安装扩展并配对。</p>
          )}
          {state.browsers.map((browser) => (
            <section key={browser.id}>
              <h2>{browser.name}</h2>
              <p>{browser.connected ? '在线' : '离线，等待浏览器重新连接'}</p>
              <p>配置标识：{browser.id}</p>
              <button
                disabled={state.busy}
                onClick={() => {
                  revoke(browser.id);
                }}
              >
                撤销此浏览器配对
              </button>
              {browser.connected && (
                <ul>
                  {browser.tabs.map((tab) => (
                    <li key={tab.id}>
                      <strong>{tab.title}</strong>
                      <p>{tab.url}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
export function App({ controller }: { controller: Controller }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  return (
    <Dashboard
      state={state}
      approve={(id) => {
        controller.approve(id).catch(controller.stop);
      }}
      reject={(id) => {
        controller.reject(id).catch(controller.stop);
      }}
      revoke={(id) => {
        controller.revoke(id).catch(controller.stop);
      }}
    />
  );
}
