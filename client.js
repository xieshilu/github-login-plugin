/**
 * Client half of `@local/github-login` — the Settings -> GitHub page.
 *
 * The page talks to its own Host half over same-origin routes under
 * `/api/dsh-github-login/*`. The access token is only ever sent Host-ward; nothing here
 * receives it back, and the tool path resolves the credential on the Host side.
 *
 * Visual language follows the reference app the user pointed at: one centred status
 * hero, capsule buttons, hairline icons, roomy rounded cards. Surfaces and text stay on
 * Harness theme tokens; brand tint is derived with color-mix rather than hard-coded.
 */

window.__ModuleLoader__.load({
  id: '@local/github-login',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const ROUTES = {
      status: '/api/dsh-github-login/status',
      token: '/api/dsh-github-login/token',
      logout: '/api/dsh-github-login/logout',
      networkSave: '/api/dsh-github-login/network/save',
      networkTest: '/api/dsh-github-login/network/test',
      deviceStart: '/api/dsh-github-login/device/start',
      devicePoll: '/api/dsh-github-login/device/poll',
      deviceCancel: '/api/dsh-github-login/device/cancel',
    };

    const CSS = `
.ghl-root { display: flex; flex-direction: column; gap: 18px; max-width: 720px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }

.ghl-hero { position: relative; display: flex; align-items: center; gap: 16px; padding: 20px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 18px; background: var(--dsw-alias-bg-layer-1); background-image: radial-gradient(120% 160% at 0% 0%, color-mix(in oklab, var(--dsw-alias-brand-primary) 16%, transparent), transparent 62%); overflow: hidden; }
.ghl-ring { flex: 0 0 auto; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; border: 1px dashed var(--dsw-alias-border-l2); color: var(--dsw-alias-brand-primary); }
.ghl-ring img { width: 54px; height: 54px; border-radius: 50%; object-fit: cover; display: block; }
.ghl-hero-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ghl-hero-title { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.ghl-hero-sub { color: var(--dsw-alias-label-secondary); }
.ghl-hero-link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.ghl-hero-link:hover { text-decoration: underline; }
.ghl-pill { margin-left: auto; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ghl-pill-on { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 45%, transparent); background: color-mix(in oklab, var(--dsw-alias-state-success-primary) 10%, transparent); }
.ghl-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.ghl-card { display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); }
.ghl-card-flat { background: transparent; }
.ghl-card-head { display: flex; align-items: center; gap: 8px; }
.ghl-card-title { margin: 0; font-size: 13px; font-weight: 600; }
.ghl-desc { margin: 0; color: var(--dsw-alias-label-secondary); }
.ghl-hint { margin: 0; color: var(--dsw-alias-label-secondary); }
.ghl-small { font-size: 12px; line-height: 18px; }

.ghl-seg { display: inline-flex; align-self: flex-start; gap: 3px; padding: 3px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); }
.ghl-seg-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 14px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.ghl-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.ghl-seg-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.ghl-seg-btn[data-active="true"] { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }

.ghl-field { display: flex; flex-direction: column; gap: 6px; }
.ghl-label { font-size: 12px; font-weight: 500; letter-spacing: 0.02em; color: var(--dsw-alias-label-secondary); }
.ghl-input { box-sizing: border-box; width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; outline: none; transition: border-color 120ms ease; }
.ghl-input::placeholder { color: var(--dsw-alias-label-secondary); }
.ghl-input:focus { border-color: var(--dsw-alias-brand-primary); }
.ghl-input:disabled { opacity: 0.7; }

.ghl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ghl-spacer { flex: 1 1 auto; }
.ghl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; transition: border-color 120ms ease, background 120ms ease; }
.ghl-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.ghl-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.ghl-btn-primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-static-neutral-bluish-00, #ffffff); font-weight: 500; }
.ghl-btn-primary:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); background: color-mix(in oklab, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-label-primary)); }
.ghl-btn:disabled { opacity: 0.45; cursor: default; }

.ghl-notice { display: flex; gap: 8px; padding: 9px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; font-size: 12px; line-height: 18px; }
.ghl-notice-error { border-color: color-mix(in oklab, var(--dsw-alias-state-error-primary) 55%, transparent); color: var(--dsw-alias-state-error-primary); }
.ghl-notice-ok { border-color: color-mix(in oklab, var(--dsw-alias-state-success-primary) 55%, transparent); color: var(--dsw-alias-state-success-primary); }
.ghl-notice-info { color: var(--dsw-alias-label-secondary); }

.ghl-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; }
.ghl-tile { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); min-width: 0; }
.ghl-tile dt { margin: 0 0 3px; font-size: 11px; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary); }
.ghl-tile dd { margin: 0; overflow-wrap: anywhere; }

.ghl-codebox { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 18px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-2); background-image: radial-gradient(120% 140% at 50% 0%, color-mix(in oklab, var(--dsw-alias-brand-primary) 12%, transparent), transparent 70%); }
.ghl-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 26px; font-weight: 600; letter-spacing: 0.34em; padding-left: 0.34em; }
.ghl-step { margin: 0; color: var(--dsw-alias-label-secondary); text-align: center; }
.ghl-pre { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 19px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ghl-skeleton { color: var(--dsw-alias-label-secondary); }
.ghl-state-ok { color: var(--dsw-alias-state-success-primary); }
.ghl-state-error { color: var(--dsw-alias-state-error-primary); }
.ghl-checks { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }
.ghl-check { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; }
.ghl-check-name { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--dsw-alias-label-secondary); }
.ghl-check-state { margin-left: auto; overflow-wrap: anywhere; }
.ghl-icon { flex: 0 0 auto; display: block; color: var(--dsw-alias-label-secondary); }
.ghl-icon-brand { color: var(--dsw-alias-brand-primary); }

@media (max-width: 560px) {
  .ghl-grid { grid-template-columns: 1fr; }
  .ghl-pill { margin-left: 0; }
  .ghl-hero { flex-wrap: wrap; }
}
`;

    /* ------------------------------------------------------------ 文案 */

    const DICT = {
      'zh-CN': {
        'nav.label': 'GitHub',
        'hero.outTitle': '连接你的 GitHub 账户',
        'hero.outSub': '登录后助手可以读写仓库、Issue 与 Pull Request。',
        'hero.pillOut': '未连接',
        'hero.pillIn': '已连接',
        'page.loading': '正在读取登录状态…',
        'page.retry': '重试',
        'page.note': '令牌只保存在本机凭据库，不会回传到页面或模型。',
        'tab.token': '访问令牌',
        'tab.device': '设备码',
        'token.title': '粘贴访问令牌',
        'token.desc': '在 GitHub 生成 Personal Access Token（勾选 repo、read:user），粘贴后立即生效。',
        'token.label': '访问令牌',
        'token.placeholder': 'ghp_… 或 github_pat_…',
        'token.submit': '连接账户',
        'token.create': '去 GitHub 创建令牌',
        'token.required': '请先粘贴访问令牌。',
        'token.invalid': '当前令牌无法通过 GitHub 校验：',
        'device.title': '用设备码授权',
        'device.desc': '需要一个启用了 Device Flow 的 OAuth App，填入它的 Client ID 即可，无需 Client Secret。该流程访问 github.com，需要网络可达。',
        'device.label': 'OAuth App 的 Client ID',
        'device.start': '生成设备码',
        'device.required': '请先填写 Client ID。',
        'device.step': '在浏览器打开下面的地址，输入设备码并确认授权',
        'device.waiting': '正在等待你在 GitHub 上确认…',
        'device.continue': '我已完成授权',
        'device.cancel': '取消',
        'device.expired': '设备码已过期，请重新生成。',
        'device.denied': '授权被拒绝。',
        'device.stillWaiting': '还没有收到授权，请确认已在 GitHub 上点击确认。',
        'account.title': '账户',
        'account.signOut': '退出登录',
        'account.refresh': '刷新',
        'account.source': '令牌来源',
        'account.scopes': '权限范围',
        'account.kind': '令牌类型',
        'account.noScopes': '未声明',
        'account.toolHint': '助手现在可以调用 github 工具，以你的身份访问 GitHub。',
        'signed.done': '已登录 GitHub。',
        'signOut.done': '已退出登录，令牌已从本机凭据库删除。',
        'signOut.envOnly': '令牌来自环境变量，页面内无法退出；如需更换请修改环境变量。',
        'source.store': '本机凭据库',
        'source.environment': '环境变量',
        'source.unknown': '未知',
        'kind.classic': '经典令牌',
        'kind.fineGrained': '细粒度令牌',
        'tool.title': '给助手的工具',
        'tool.desc': 'github 工具复用同一份令牌，令牌不会出现在对话里。',
        'tool.note': '在对话里说「列出我的仓库」，助手就会调用它。',
        'error.network': '无法连接本机 Host。',
        'error.oauthUnreachable': '无法连接 github.com（设备码接口在 github.com，不在 api.github.com）。请确认代理或 VPN 已开启，或改用访问令牌。',
        'net.title': '网络与代理',
        'net.desc': '留空表示直连。填写后，登录校验、设备码授权与 github 工具的每一条 GitHub 请求都会走这个 HTTP 代理。',
        'net.label': '代理地址',
        'net.placeholder': 'http://127.0.0.1:7897',
        'net.save': '保存',
        'net.test': '测试连接',
        'net.testing': '测试中…',
        'net.saved': '代理设置已保存。',
        'net.cleared': '已切换为直连。',
        'net.invalid': '代理地址无效，请检查格式。',
        'net.api': 'api.github.com',
        'net.web': 'github.com',
        'net.ok': '可用',
        'net.fail': '失败',
        'net.env': '来自环境变量：',
      },
      en: {
        'nav.label': 'GitHub',
        'hero.outTitle': 'Connect your GitHub account',
        'hero.outSub': 'The agent can then read repositories, issues, and pull requests as you.',
        'hero.pillOut': 'Not connected',
        'hero.pillIn': 'Connected',
        'page.loading': 'Reading sign-in state…',
        'page.retry': 'Retry',
        'page.note': 'The token stays in the local credential store; it never comes back to the page or the model.',
        'tab.token': 'Access token',
        'tab.device': 'Device code',
        'token.title': 'Paste an access token',
        'token.desc': 'Create a personal access token on GitHub (scopes repo, read:user) and paste it here.',
        'token.label': 'Access token',
        'token.placeholder': 'ghp_… or github_pat_…',
        'token.submit': 'Connect account',
        'token.create': 'Create a token on GitHub',
        'token.required': 'Paste an access token first.',
        'token.invalid': 'The current token does not pass GitHub validation: ',
        'device.title': 'Authorize with a device code',
        'device.desc': 'Needs a GitHub OAuth App with Device Flow enabled. Paste its Client ID; no client secret is required.',
        'device.label': 'OAuth App Client ID',
        'device.start': 'Get a device code',
        'device.required': 'Enter the Client ID first.',
        'device.step': 'Open this address in a browser, enter the code, and approve',
        'device.waiting': 'Waiting for you to approve on GitHub…',
        'device.continue': 'I approved it',
        'device.cancel': 'Cancel',
        'device.expired': 'The device code expired. Get a new one.',
        'device.denied': 'Authorization was denied.',
        'device.stillWaiting': 'No approval yet — confirm you clicked Approve on GitHub.',
        'account.title': 'Account',
        'account.signOut': 'Sign out',
        'account.refresh': 'Refresh',
        'account.source': 'Token source',
        'account.scopes': 'Scopes',
        'account.kind': 'Token type',
        'account.noScopes': 'none',
        'account.toolHint': 'The agent can now call the github tool with your identity.',
        'signed.done': 'Signed in to GitHub.',
        'signOut.done': 'Signed out; the token was removed from the local credential store.',
        'signOut.envOnly': 'The token comes from the environment; sign-out cannot remove it here.',
        'source.store': 'Local store',
        'source.environment': 'Environment',
        'source.unknown': 'Unknown',
        'kind.classic': 'Classic token',
        'kind.fineGrained': 'Fine-grained token',
        'tool.title': 'Tool for the agent',
        'tool.desc': 'The github tool reuses the stored token; the token never appears in the conversation.',
        'tool.note': 'Say “list my repositories” in a chat and the agent will call it.',
        'error.network': 'Cannot reach the local Host.',
        'error.oauthUnreachable': 'Cannot reach github.com (the device-code endpoints live there, not on api.github.com). Check your proxy or VPN, or use an access token.',
        'net.title': 'Network and proxy',
        'net.desc': 'Leave empty to go direct. When set, every GitHub request — token checks, device approval, and the github tool — tunnels through this HTTP proxy.',
        'net.label': 'Proxy address',
        'net.placeholder': 'http://127.0.0.1:7897',
        'net.save': 'Save',
        'net.test': 'Test connection',
        'net.testing': 'Testing…',
        'net.saved': 'Proxy saved.',
        'net.cleared': 'Back to a direct connection.',
        'net.invalid': 'That proxy address is not valid.',
        'net.api': 'api.github.com',
        'net.web': 'github.com',
        'net.ok': 'reachable',
        'net.fail': 'failed',
        'net.env': 'From environment: ',
      },
    };

    /**
     * 这个页面固定使用中文文案（用户要求界面为中文），不跟随应用语言设置；
     * 英文表保留作为缺键兜底。
     */
    function createTranslator() {
      const zh = DICT['zh-CN'];
      return (key) => zh[key] || DICT.en[key] || key;
    }

    /* ------------------------------------------------------------ 与 Host 通信 */

    async function call(path, payload) {
      const init =
        payload === undefined
          ? { method: 'GET', headers: { accept: 'application/json' } }
          : {
              method: 'POST',
              headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            };
      try {
        const response = await fetch(path, init);
        const text = await response.text();
        let data = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = { error: 'invalid-response' };
          }
        }
        return { ok: response.ok, status: response.status, data: data && typeof data === 'object' ? data : {} };
      } catch {
        return { ok: false, status: 0, data: { error: 'network-error' } };
      }
    }

    function describeError(t, data, status) {
      if (!data) return `HTTP ${status}`;
      if (data.error === 'network-error') return t('error.network');
      if (data.error === 'oauth-unreachable') return t('error.oauthUnreachable');
      if (data.error === 'invalid-proxy') return t('net.invalid');
      const detail = typeof data.error === 'string' && data.error ? data.error : `HTTP ${status}`;
      return typeof data.hint === 'string' && data.hint ? `${detail} — ${data.hint}` : detail;
    }

    function describeSource(t, source) {
      if (!source) return t('source.unknown');
      return /env|process/i.test(source) ? t('source.environment') : t('source.store');
    }

    /* ------------------------------------------------------------ 图标 */

    function Icon(props) {
      const size = props.size || 16;
      return h(
        'svg',
        {
          className: props.brand ? 'ghl-icon ghl-icon-brand' : 'ghl-icon',
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: props.weight || 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        props.paths.map((d, index) => h('path', { key: index, d })),
        props.circles ? props.circles.map((circle, index) => h('circle', { key: `c${index}`, ...circle })) : null,
      );
    }

    const ICONS = {
      branch: {
        paths: ['M6 16V7.5A4 4 0 0 1 10 3.5h2', 'M10 12.5h2a4 4 0 0 0 4-4V6'],
        circles: [
          { cx: 5, cy: 16, r: 2 },
          { cx: 4.2, cy: 5, r: 2 },
          { cx: 16, cy: 5, r: 2 },
        ],
      },
      key: {
        paths: ['M12.5 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M9.6 9.4 3 16v1h2v-2h2v-2h1.6'],
      },
      device: {
        paths: [
          'M6.5 3.5h7a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 15V5a1.5 1.5 0 0 1 1.5-1.5z',
          'M9 14.2h2',
        ],
      },
      external: {
        paths: ['M11 4h5v5', 'M16 4l-6.5 6.5', 'M15 12.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5'],
      },
      terminal: {
        paths: ['M4 5h12v10H4z', 'M7 9l2 1.5L7 12', 'M11 12.5h2.5'],
      },
      network: {
        paths: [
          'M10 3.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6z',
          'M3.4 8h13.2',
          'M3.4 12h13.2',
          'M10 3.2c1.9 2.1 2.9 4.3 2.9 6.8S11.9 14.7 10 16.8C8.1 14.7 7.1 12.5 7.1 10S8.1 5.3 10 3.2z',
        ],
      },
    };

    /* ------------------------------------------------------------ 基础组件 */

    function Notice(props) {
      const kind = props.kind || 'info';
      return h(
        'div',
        { className: `ghl-notice ghl-notice-${kind}`, role: kind === 'error' ? 'alert' : undefined },
        props.children,
      );
    }

    function Field(props) {
      return h(
        'div',
        { className: 'ghl-field' },
        h('label', { className: 'ghl-label', htmlFor: props.id }, props.label),
        props.children,
      );
    }

    function Button(props) {
      return h(
        'button',
        {
          type: 'button',
          className: props.variant === 'primary' ? 'ghl-btn ghl-btn-primary' : 'ghl-btn',
          disabled: Boolean(props.disabled),
          onClick: props.disabled ? undefined : props.onClick,
        },
        props.children,
      );
    }

    function Hero(props) {
      const signedIn = props.status && props.status.signedIn;
      const user = (props.status && props.status.user) || {};
      return h(
        'section',
        { className: 'ghl-hero' },
        h(
          'div',
          { className: 'ghl-ring' },
          signedIn && user.avatarUrl
            ? h('img', { src: user.avatarUrl, alt: user.login || 'GitHub 头像' })
            : h(Icon, { ...ICONS.branch, size: 28, weight: 1.4 }),
        ),
        h(
          'div',
          { className: 'ghl-hero-text' },
          h('div', { className: 'ghl-hero-title' }, signedIn ? user.name || user.login || '' : props.t('hero.outTitle')),
          signedIn
            ? h(
                'div',
                { className: 'ghl-hero-sub' },
                user.htmlUrl
                  ? h(
                      'a',
                      { className: 'ghl-hero-link', href: user.htmlUrl, target: '_blank', rel: 'noreferrer noopener' },
                      `@${user.login}`,
                    )
                  : `@${user.login || ''}`,
              )
            : h('div', { className: 'ghl-hero-sub' }, props.t('hero.outSub')),
        ),
        h(
          'span',
          { className: signedIn ? 'ghl-pill ghl-pill-on' : 'ghl-pill' },
          h('span', { className: 'ghl-dot' }),
          signedIn ? props.t('hero.pillIn') : props.t('hero.pillOut'),
        ),
      );
    }

    /* ------------------------------------------------------------ 访问令牌 */

    function TokenPanel(props) {
      const t = props.t;
      const [token, setToken] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const submit = useCallback(async () => {
        const value = token.trim();
        if (!value) {
          setError(t('token.required'));
          return;
        }
        setBusy(true);
        setError(null);
        const result = await call(ROUTES.token, { token: value });
        setBusy(false);
        if (!result.ok) {
          setError(describeError(t, result.data, result.status));
          return;
        }
        setToken('');
        props.onSigned(result.data);
      }, [token, t, props.onSigned]);

      return h(
        'section',
        { className: 'ghl-card' },
        h(
          'div',
          { className: 'ghl-card-head' },
          h(Icon, { ...ICONS.key }),
          h('h3', { className: 'ghl-card-title' }, t('token.title')),
        ),
        h('p', { className: 'ghl-desc' }, t('token.desc')),
        props.invalidMessage ? h(Notice, { kind: 'error' }, props.invalidMessage) : null,
        h(
          Field,
          { label: t('token.label'), id: 'ghl-token-input' },
          h('input', {
            id: 'ghl-token-input',
            className: 'ghl-input',
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: t('token.placeholder'),
            value: token,
            onChange: (event) => setToken(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') submit();
            },
          }),
        ),
        error ? h(Notice, { kind: 'error' }, error) : null,
        h(
          'div',
          { className: 'ghl-row' },
          h(
            Button,
            { variant: 'primary', disabled: busy || token.trim() === '', onClick: submit },
            busy ? '…' : t('token.submit'),
          ),
          h(
            'a',
            { className: 'ghl-hero-link ghl-small', href: props.tokenUrl, target: '_blank', rel: 'noreferrer noopener' },
            t('token.create'),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------ 设备码 */

    function DevicePanel(props) {
      const t = props.t;
      const [clientId, setClientId] = useState(props.clientId || '');
      const [flow, setFlow] = useState(null);
      const [phase, setPhase] = useState('idle');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [hint, setHint] = useState(null);
      const intervalRef = useRef(5);

      useEffect(() => {
        if (props.clientId && !clientId) setClientId(props.clientId);
      }, [props.clientId]);

      const start = useCallback(async () => {
        const typed = clientId.trim();
        if (!typed) {
          setError(t('device.required'));
          return;
        }
        setBusy(true);
        setError(null);
        setHint(null);
        const result = await call(ROUTES.deviceStart, { clientId: typed });
        setBusy(false);
        if (!result.ok) {
          setError(describeError(t, result.data, result.status));
          return;
        }
        intervalRef.current = Number(result.data.interval) || 5;
        setFlow(result.data);
        setPhase('waiting');
      }, [clientId, t]);

      const pollOnce = useCallback(async () => {
        if (!flow) return 'stop';
        const result = await call(ROUTES.devicePoll, { flowId: flow.flowId });
        const data = result.data || {};
        if (data.status === 'authorized') {
          setPhase('authorized');
          setFlow(null);
          props.onSigned();
          return 'stop';
        }
        if (data.status === 'expired') {
          setPhase('expired');
          setFlow(null);
          return 'stop';
        }
        if (data.status === 'denied') {
          setPhase('denied');
          setFlow(null);
          return 'stop';
        }
        if (data.status === 'error') {
          setPhase('error');
          setError(describeError(t, data, result.status));
          return 'stop';
        }
        const interval = Number(data.interval);
        if (Number.isFinite(interval) && interval > 0) intervalRef.current = interval;
        return 'wait';
      }, [flow, props.onSigned, t]);

      useEffect(() => {
        if (phase !== 'waiting' || !flow) return undefined;
        let alive = true;
        let timer = null;
        const loop = async () => {
          const verdict = await pollOnce();
          if (!alive || verdict === 'stop') return;
          timer = setTimeout(loop, Math.max(1, intervalRef.current) * 1000);
        };
        timer = setTimeout(loop, Math.max(1, intervalRef.current) * 1000);
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, [phase, flow, pollOnce]);

      const cancel = useCallback(async () => {
        if (flow) await call(ROUTES.deviceCancel, { flowId: flow.flowId });
        setFlow(null);
        setPhase('idle');
        setHint(null);
      }, [flow]);

      const nudge = useCallback(async () => {
        setBusy(true);
        setHint(null);
        const verdict = await pollOnce();
        setBusy(false);
        if (verdict === 'wait') setHint(t('device.stillWaiting'));
      }, [pollOnce, t]);

      return h(
        'section',
        { className: 'ghl-card' },
        h(
          'div',
          { className: 'ghl-card-head' },
          h(Icon, { ...ICONS.device }),
          h('h3', { className: 'ghl-card-title' }, t('device.title')),
        ),
        h('p', { className: 'ghl-desc' }, t('device.desc')),
        h(
          Field,
          { label: t('device.label'), id: 'ghl-client-id' },
          h('input', {
            id: 'ghl-client-id',
            className: 'ghl-input',
            type: 'text',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: 'Iv1.0123456789abcdef',
            value: clientId,
            onChange: (event) => setClientId(event.target.value),
            disabled: phase === 'waiting',
          }),
        ),
        error ? h(Notice, { kind: 'error' }, error) : null,
        phase === 'idle' || phase === 'error'
          ? h(
              'div',
              { className: 'ghl-row' },
              h(Button, { variant: 'primary', disabled: busy, onClick: start }, busy ? '…' : t('device.start')),
            )
          : null,
        flow
          ? h(
              'div',
              { className: 'ghl-codebox' },
              h('p', { className: 'ghl-step ghl-small' }, t('device.step')),
              h('div', { className: 'ghl-code' }, flow.userCode),
              h(
                'a',
                {
                  className: 'ghl-btn ghl-small',
                  href: flow.verificationUri,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                  style: { textDecoration: 'none' },
                },
                flow.verificationUri,
                h(Icon, { ...ICONS.external, size: 14 }),
              ),
              h('p', { className: 'ghl-step ghl-small' }, t('device.waiting')),
            )
          : null,
        hint ? h(Notice, { kind: 'info' }, hint) : null,
        flow
          ? h(
              'div',
              { className: 'ghl-row' },
              h(Button, { variant: 'primary', disabled: busy, onClick: nudge }, t('device.continue')),
              h(Button, { disabled: busy, onClick: cancel }, t('device.cancel')),
            )
          : null,
        phase === 'expired' ? h(Notice, { kind: 'error' }, t('device.expired')) : null,
        phase === 'denied' ? h(Notice, { kind: 'error' }, t('device.denied')) : null,
      );
    }

    /* ------------------------------------------------------------ 账户 */

    function AccountPanel(props) {
      const t = props.t;
      const status = props.status;
      const scopes = Array.isArray(status.scopes) ? status.scopes : [];
      return h(
        'section',
        { className: 'ghl-card' },
        h(
          'div',
          { className: 'ghl-card-head' },
          h(Icon, { ...ICONS.terminal }),
          h('h3', { className: 'ghl-card-title' }, t('account.title')),
          h('span', { className: 'ghl-spacer' }),
          h(
            Button,
            { disabled: props.refreshing, onClick: props.onRefresh },
            props.refreshing ? '…' : t('account.refresh'),
          ),
        ),
        h(
          'dl',
          { className: 'ghl-grid' },
          h(
            'div',
            { className: 'ghl-tile' },
            h('dt', null, t('account.source')),
            h('dd', null, describeSource(t, status.tokenSource)),
          ),
          h(
            'div',
            { className: 'ghl-tile' },
            h('dt', null, t('account.kind')),
            h('dd', null, status.tokenKind === 'classic' ? t('kind.classic') : t('kind.fineGrained')),
          ),
          h(
            'div',
            { className: 'ghl-tile' },
            h('dt', null, t('account.scopes')),
            h('dd', null, scopes.length ? scopes.join(', ') : t('account.noScopes')),
          ),
        ),
        h('p', { className: 'ghl-hint ghl-small' }, t('account.toolHint')),
        h(
          'div',
          { className: 'ghl-row' },
          h(Button, { disabled: props.busy, onClick: props.onSignOut }, t('account.signOut')),
        ),
      );
    }

    /* ------------------------------------------------------------ 网络与代理 */

    function NetworkPanel(props) {
      const t = props.t;
      const [value, setValue] = useState(props.proxy || '');
      const [busy, setBusy] = useState(false);
      const [testing, setTesting] = useState(false);
      const [message, setMessage] = useState(null);
      const [error, setError] = useState(null);
      const [checks, setChecks] = useState(null);

      useEffect(() => {
        setValue(props.proxy || '');
      }, [props.proxy]);

      const save = useCallback(async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        setChecks(null);
        const result = await call(ROUTES.networkSave, { proxy: value });
        setBusy(false);
        if (!result.ok) {
          setError(describeError(t, result.data, result.status));
          return;
        }
        setMessage(value.trim() ? t('net.saved') : t('net.cleared'));
        props.onSaved(result.data);
      }, [value, t, props.onSaved]);

      const test = useCallback(async () => {
        setTesting(true);
        setError(null);
        setChecks(null);
        const result = await call(ROUTES.networkTest, {});
        setTesting(false);
        if (!result.ok) {
          setError(describeError(t, result.data, result.status));
          return;
        }
        setChecks(result.data.checks || {});
      }, [t]);

      const checkRow = (key, label) => {
        const check = checks ? checks[key] : null;
        if (!check) return null;
        const state = check.ok
          ? `${t('net.ok')} · ${check.status} · ${check.ms} ms`
          : `${t('net.fail')} · ${check.error || `HTTP ${check.status}`}`;
        return h(
          'div',
          { className: 'ghl-check' },
          h('span', { className: 'ghl-check-name' }, label),
          h(
            'span',
            { className: check.ok ? 'ghl-check-state ghl-state-ok' : 'ghl-check-state ghl-state-error' },
            state,
          ),
        );
      };

      const fromEnvironment = typeof props.proxySource === 'string' && props.proxySource.startsWith('env:');

      return h(
        'section',
        { className: 'ghl-card' },
        h(
          'div',
          { className: 'ghl-card-head' },
          h(Icon, { ...ICONS.network }),
          h('h3', { className: 'ghl-card-title' }, t('net.title')),
        ),
        h('p', { className: 'ghl-desc' }, t('net.desc')),
        fromEnvironment
          ? h('p', { className: 'ghl-hint ghl-small' }, `${t('net.env')}${props.proxySource.slice(4)}`)
          : null,
        h(
          Field,
          { label: t('net.label'), id: 'ghl-proxy-input' },
          h('input', {
            id: 'ghl-proxy-input',
            className: 'ghl-input',
            type: 'text',
            spellCheck: false,
            autoComplete: 'off',
            placeholder: t('net.placeholder'),
            value,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') save();
            },
          }),
        ),
        error ? h(Notice, { kind: 'error' }, error) : null,
        message ? h(Notice, { kind: 'ok' }, message) : null,
        checks
          ? h('div', { className: 'ghl-checks' }, checkRow('api', t('net.api')), checkRow('web', t('net.web')))
          : null,
        h(
          'div',
          { className: 'ghl-row' },
          h(Button, { variant: 'primary', disabled: busy, onClick: save }, busy ? '…' : t('net.save')),
          h(Button, { disabled: testing, onClick: test }, testing ? t('net.testing') : t('net.test')),
        ),
      );
    }

    function ToolHint(props) {
      const t = props.t;
      return h(
        'section',
        { className: 'ghl-card ghl-card-flat' },
        h(
          'div',
          { className: 'ghl-card-head' },
          h(Icon, { ...ICONS.key }),
          h('h3', { className: 'ghl-card-title' }, t('tool.title')),
        ),
        h('p', { className: 'ghl-desc' }, t('tool.desc')),
        h(
          'pre',
          { className: 'ghl-pre' },
          'github { action: "whoami" }\n' + 'github { action: "request", method: "GET", path: "user/repos" }',
        ),
        h('p', { className: 'ghl-hint ghl-small' }, t('tool.note')),
      );
    }

    /* ------------------------------------------------------------ 页面 */

    function createSection(t) {
      return function GitHubSettingsSection() {
        const [status, setStatus] = useState(null);
        const [loading, setLoading] = useState(true);
        const [refreshing, setRefreshing] = useState(false);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState(null);
        const [notice, setNotice] = useState(null);
        const [tab, setTab] = useState('token');

        const load = useCallback(
          async (mode) => {
            if (mode === 'refresh') setRefreshing(true);
            else setLoading(true);
            const result = await call(ROUTES.status);
            if (mode === 'refresh') setRefreshing(false);
            else setLoading(false);
            if (result.ok) {
              setStatus(result.data);
              setError(null);
            } else {
              setError(describeError(t, result.data, result.status));
            }
          },
          [t],
        );

        useEffect(() => {
          load('load');
        }, [load]);

        const signedIn = useCallback(
          (payload) => {
            if (payload && typeof payload === 'object' && 'signedIn' in payload) setStatus(payload);
            setNotice(t('signed.done'));
            setError(null);
            load('refresh');
          },
          [load, t],
        );

        const signOut = useCallback(async () => {
          setBusy(true);
          const result = await call(ROUTES.logout, {});
          setBusy(false);
          if (!result.ok) {
            setError(describeError(t, result.data, result.status));
            return;
          }
          setStatus(result.data);
          setNotice(result.data.stillFromEnvironment ? t('signOut.envOnly') : t('signOut.done'));
        }, [t]);

        const invalidMessage =
          status && !status.signedIn && status.invalidToken ? `${t('token.invalid')}${status.error || ''}` : null;

        return h(
          'div',
          { className: 'ghl-root' },
          h(Hero, { t, status }),
          notice ? h(Notice, { kind: 'ok' }, notice) : null,
          error ? h(Notice, { kind: 'error' }, error) : null,
          loading && !status ? h('p', { className: 'ghl-skeleton' }, t('page.loading')) : null,
          status && status.signedIn
            ? h(AccountPanel, { t, status, refreshing, busy, onRefresh: () => load('refresh'), onSignOut: signOut })
            : null,
          status && !status.signedIn
            ? h(
                'div',
                { className: 'ghl-root' },
                h(
                  'div',
                  { className: 'ghl-seg', role: 'tablist' },
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'tab',
                      className: 'ghl-seg-btn',
                      'data-active': tab === 'token' ? 'true' : 'false',
                      'aria-selected': tab === 'token',
                      onClick: () => setTab('token'),
                    },
                    h(Icon, { ...ICONS.key, size: 14 }),
                    t('tab.token'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'tab',
                      className: 'ghl-seg-btn',
                      'data-active': tab === 'device' ? 'true' : 'false',
                      'aria-selected': tab === 'device',
                      onClick: () => setTab('device'),
                    },
                    h(Icon, { ...ICONS.device, size: 14 }),
                    t('tab.device'),
                  ),
                ),
                tab === 'token'
                  ? h(TokenPanel, { t, tokenUrl: status.tokenUrl, invalidMessage, onSigned: signedIn })
                  : h(DevicePanel, { t, clientId: status.clientId, onSigned: signedIn }),
              )
            : null,
          h('p', { className: 'ghl-hint ghl-small' }, t('page.note')),
          status
            ? h(NetworkPanel, {
                t,
                proxy: status.proxy,
                proxySource: status.proxySource,
                onSaved: (payload) => setStatus((current) => (current ? { ...current, ...payload } : current)),
              })
            : null,
          h(ToolHint, { t }),
        );
      };
    }

    /* ------------------------------------------------------------ 模块入口 */

    return {
      inject: ['slots'],
      apply(ctx) {
        if (typeof document !== 'undefined') {
          ctx.effect(() => {
            const tag = document.createElement('style');
            tag.dataset.plugin = '@local/github-login';
            tag.textContent = CSS;
            document.head.appendChild(tag);
            return () => {
              tag.remove();
            };
          }, 'github-login: styles');
        }

        const t = createTranslator();

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'github-account',
              order: 25,
              label: () => t('nav.label'),
            },
            createSection(t),
          ),
        );
      },
    };
  },
});
