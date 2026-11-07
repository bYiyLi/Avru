import type { MessageKey } from './en';
export const zh = {
  'popup.title': 'Avru 浏览器连接',
  'popup.checking': '检查连接…',
  'popup.description':
    '连接后会同步普通网页标签的标题和地址（不含查询参数、片段或无痕标签）。本阶段不操作网页。',
  'popup.endpoint': '本机服务',
  'popup.name': '浏览器 / 配置名称',
  'popup.namePlaceholder': '例如：Chrome 工作',
  'popup.pairingHelp':
    '连接后，在本机 Avru 管理页面比较六位核对码并批准。不需复制或输入凭据。',
  'popup.pair': '配对',
  'popup.disconnect': '断开并清除本地凭据',
  'popup.revokeHelp':
    '清除本地凭据不等于撤销服务端登记；彻底撤销请到管理页面操作。',
  'status.unpaired': '未配对',
  'status.connecting': '连接中',
  'status.connected': '已连接',
  'status.pairing': '请在本机管理页核对 {code} 并批准',
  'status.rejected': '连接被拒绝或配对已过期，请重新配对',
  'status.reconnecting': '已断开，等待重连',
  'status.protocolError': '协议错误，请重新配对',
  'status.requestFailed': '请求失败，请检查连接信息',
  'status.unavailable': '后台未就绪',
  'status.connectionFailed': '连接失败，请检查配对信息和守护进程',
  'consent.title': 'Avru 授权确认',
  'consent.heading': '允许连接 Avru？',
  'consent.description':
    '仅允许你刚发起的请求。此授权可读取已连接浏览器的标签页标题和地址。',
  'consent.allow': '允许',
  'consent.deny': '拒绝',
  'consent.submitted': '请求已提交；请返回原应用。',
  'consent.disconnected': '连接已断开，请重新发起授权。',
  'consent.invalid': '没有有效的授权请求。请关闭窗口后重新发起。',
  'consent.application': '请求应用',
  'consent.redirectUri': '回调地址',
  'consent.resource': '授权服务',
} as const satisfies Record<MessageKey, string>;
