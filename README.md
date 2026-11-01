# GitHub 登录插件 · 使用说明

> 插件标识：`@local/github-login`　入口行：`include:github-login`
> 安装位置：`<workspace>\github-login\`（本机 bundle，非 npm 包）
> 界面入口：Harness Web UI → 设置 → **GitHub 账号**（槽位 `settings.section`，id `github-account`）

---

## 1. 它是做什么的

让 DeepSeek Harness 以**你本人**的 GitHub 身份工作：在设置页完成一次登录，之后助手在对话中通过 `github` 工具读写仓库、Issue、Pull Request，不需要你在每次对话里粘贴令牌。

三条设计原则：

1. **令牌只在 Host 侧**。浏览器页面和模型都拿不到令牌原文，页面只能看到"已登录 + 账号名 + 权限范围"。
2. **一个出口**。登录校验、设备码流程、`github` 工具全部走同一条传输层，配了代理就都走代理，不会被某条路径绕过。
3. **两种登录方式**。个人访问令牌（最快）或 GitHub 设备码授权（不用手动抄令牌）。

---

## 2. 功能总览

| 功能 | 位置 | 说明 |
| --- | --- | --- |
| 账户状态卡 | 设置 → GitHub 账号 | 头像、账号名、状态胶囊；未登录 / 已连接 / 令牌失效三种形态 |
| 访问令牌登录 | 同上，「访问令牌」页签 | 粘贴 PAT（经典或细粒度），当场调 `GET /user` 校验后保存 |
| 设备码登录 | 同上，「设备码」页签 | 用你自己的 OAuth App Client ID 走 GitHub Device Flow，无需 Client Secret |
| 已登录详情 | 同上 | 账户、令牌来源（本机凭据库 / 环境变量）、权限范围、令牌类型 |
| 退出登录 | 同上「退出登录」 | 删除本机凭据库里的令牌 |
| 刷新 | 同上「刷新」 | 重新读取状态；账号信息有 60 秒缓存，缓存过期后才重新校验 `GET /user` |
| 网络代理 | 同上「网络」区域 | 代理地址保存、连通性自检 |
| 助手工具 `github` | 对话中由助手调用 | `whoami` 查身份；`request` 直接调任意 GitHub REST 接口 |

---

## 3. 开始使用

### 3.1 方式一：访问令牌（推荐，30 秒）

1. 打开 <https://github.com/settings/tokens> 生成令牌：
   - **经典令牌**：至少勾 `repo`（读写仓库）和 `read:user`（读账号信息）。
   - **细粒度令牌**：至少给目标仓库 Contents / Issues / Pull requests 读写权限。
2. 回到设置 → GitHub 账号 → 「访问令牌」页签，粘贴令牌（`ghp_…` 或 `github_pat_…`）。
3. 点「连接账户」。校验通过后卡片变为「已连接」，显示账号与权限范围。

> 校验失败会直接显示 GitHub 返回的原因，例如 `Bad credentials`（令牌无效/已撤销）、`401`。粘贴后立即生效，不需要重启应用。

### 3.2 方式二：设备码授权

适合不想手抄令牌的场景，前置条件是**你自己有一个启用了 Device Flow 的 OAuth App**：

1. 打开 <https://github.com/settings/developers> → New OAuth App，勾选 **Enable Device Flow**，记下 **Client ID**（设备码流程不需要 Client Secret）。
2. 设置页「设备码」页签填入 Client ID → 点「生成设备码」。
3. 卡片上会出现形如 `XXXX-XXXX` 的用户码和授权地址。
4. 在浏览器打开 <https://github.com/login/device>，输入用户码并确认授权。
5. 回到设置页点「我已完成授权」（或等它自动轮询），成功后与方式一一样进入「已连接」。

轮询中的可能状态：仍在等待（继续轮询）、`slow_down`（GitHub 要求降频，间隔自动 +5 秒）、设备码过期（重新生成）、授权被拒绝。

### 3.3 已登录后

卡片显示：账户、**令牌来源**、**权限范围**（未声明时显示"未声明"）、**令牌类型**（经典令牌 / 细粒度令牌）。

- 「退出登录」：从本机凭据库删除令牌，页面立即回到未登录。
- 若令牌来自**环境变量**（`GITHUB_TOKEN` 由启动环境注入），页面无法退出，会提示去改环境变量——这是刻意的，避免页面删除后仍被环境变量"复活"。

---

## 4. 助手工具 `github`

登录后，助手在对话中可以直接调用：

**参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | `whoami` \| `request` | 是 | 查身份，或发起一次 REST 调用 |
| `method` | `GET` / `POST` / `PATCH` / `PUT` / `DELETE` | 否 | `request` 用，默认 `GET` |
| `path` | string | `request` 必填 | 不带域名，如 `repos/octocat/Hello-World/issues`、`/user/repos` |
| `body` | object | 否 | `POST`/`PATCH`/`PUT` 的 JSON 体；`GET`/`DELETE` 带体会被拒绝 |

**返回**：`ok`、`error`、`status`、`user`、`scopes`、`data`（GitHub 原始返回）。结果超过 12 KB 会截断并注明剩余长度；单次调用超时 30 秒。

**示例**

```jsonc
// 我是谁
{ "action": "whoami" }

// 列我的仓库
{ "action": "request", "method": "GET", "path": "user/repos?per_page=20&sort=updated" }

// 给某个 issue 加评论
{ "action": "request", "method": "POST", "path": "repos/owner/repo/issues/12/comments",
  "body": { "body": "收到，我来跟进。" } }
```

在对话里直接说「列出我的仓库」「看看 xxx 仓库最近的 PR」即可，助手会自行选择工具参数。**永远不需要在对话里粘贴令牌**——没登录时它会提示你去设置页登录。

---

## 5. 网络与代理

GitHub 在部分网络环境下不可直连，插件内置一层可配置的出口：

- **代理地址**保存在凭据库 `GITHUB_PROXY`，在设置页「网络」区域填写并保存，例如 `http://127.0.0.1:7897`；留空 = 直连。
- 未保存时按环境兜底：`GITHUB_PROXY` → `HTTPS_PROXY` → `https_proxy` → `HTTP_PROXY` → `http_proxy`。
- 有代理时走 **HTTP CONNECT 隧道**（`net.connect` → `CONNECT host:443` → `tls.connect`），支持 `http://user:pass@host:port` 形式。
- 「测试连接」会同时检查两件事：`api.github.com`（必须 200）与 `github.com`（有任意 HTTP 响应即算可达），并给出耗时（毫秒）。
- **TLS 校验使用操作系统信任库**（`tls.getCACertificates('system')`）。本机存在 TLS 中间人代理（系统信任库里的自有根证书）时，Node 默认只信内置公共根证，会报 `unable to verify the first certificate`；插件改用系统信任库后与浏览器行为一致。

---

## 6. 数据与安全

| 数据 | 存放位置 | 谁能看到 |
| --- | --- | --- |
| 访问令牌 | Harness 凭据库，ref = `GITHUB_TOKEN` | 仅 Host 进程；页面与模型都看不到原文 |
| OAuth App Client ID | 凭据库，ref = `GITHUB_OAUTH_CLIENT_ID` | Client ID 本身不是秘密，可显示 |
| 代理地址 | 凭据库，ref = `GITHUB_PROXY` | 设置页可见 |
| 设备码 device_code | 仅 Host 内存（一次授权一个 flow） | 从不下发给页面，页面只拿 user code 与 flowId |

注意：

1. **令牌权限即助手的权限**。给 `repo` 助手就能改你所有仓库的代码；给 `admin:org` 就能改组织设置。建议用细粒度令牌、限定仓库。
2. 设置页显示的「权限范围」来自 GitHub 响应头，令牌权限越宽，风险越大。
3. 本机若装了 TLS 中间人（例如 SteamTools、公司代理、杀毒软件抓包），令牌在网络层是可见的——这是环境问题，插件无法消除，只在校验层面与系统保持一致。

---

## 7. HTTP 接口（供二次开发 / 排查）

所有接口挂在 `/api/dsh-github-login` 下，仅供本机 Web UI 调用：

| 方法 | 路径 | 作用 | 主要返回 |
| --- | --- | --- | --- |
| GET | `/status` | 登录状态 | `signedIn`、`user`、`scopes`、`tokenKind`、`tokenSource`、`proxy`、`proxySource`、`invalidToken` |
| POST | `/token` | 提交 PAT | 同 `/status`；失败 400 + `error`/`status`/`hint` |
| POST | `/logout` | 退出 | 状态 + `removedFromStore`、`stillFromEnvironment` |
| GET | `/network` | 读当前代理 | `proxy`、`proxySource` |
| POST | `/network/save` | 保存代理（空串=清空） | `proxy`、`proxySource`；非法地址 400 `invalid-proxy` |
| POST | `/network/test` | 连通性自检 | `checks.api` / `checks.web`：`ok`、`status`、`ms` |
| POST | `/device/start` | 申请设备码 | `flowId`、`userCode`、`verificationUri`、`expiresIn`、`interval` |
| POST | `/device/poll` | 轮询授权 | `status`：`pending` / `slow_down` / `authorized` / `expired` / `denied` / `error` |
| POST | `/device/cancel` | 取消本次授权 | `status: cancelled` |

排查用的命令行示例（本机）：

```powershell
curl.exe -s --noproxy '*' http://127.0.0.1:54483/api/dsh-github-login/status
```

> GUI 端口每次启动可能不同，以运行时上下文里的地址为准。

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 卡片一直「未连接」 | 还没登录，或令牌被撤销 | 重新连接令牌 / 换设备码登录 |
| `unable to verify the first certificate` | 本机 TLS 中间人证书未被 Node 信任 | 已修：插件改用系统信任库；若仍出现，检查系统信任库是否装了该根证书 |
| `proxy-refused: HTTP/1.1 407` | 代理需要认证 | 在代理地址里写 `http://user:pass@host:port` |
| `oauth-unreachable` | 设备码接口不可达 | 「测试连接」看 `checks`，开 VPN 或改代理；或改用访问令牌 |
| `socket hang up` / 超时 | 代理没在跑，或端口填错 | 起代理进程；`GET /network/test` 复核 |
| 工具返回 `not-signed-in` | 没登录就去调工具 | 先到设置页登录 |
| 页面无法退出登录 | 令牌来自环境变量 | 改/删启动环境里的 `GITHUB_TOKEN` 后重启 |
| 设备码一直等待 | 浏览器里没点确认 | 回到 <https://github.com/login/device> 完成授权 |

---

## 9. 安装、升级与卸载

本插件是本机 bundle（不是 npm 包），通过 `plugin_manager` 管理：

- **启用 / 停用**：`set_plugin`，target `include:github-login`。
- **升级代码**：改完 `index.js` / `client.js` 后，把该行 `set_plugin` 先关再开即可热重载，无需重启 Harness。
- **卸载**：`remove_bundle`（target `@local/github-login`），并从配置里移除该行；随后可删除目录 `github-login`。

文件构成：

```
github-login/
├─ package.json            # 包清单：exports、dsh.bundle.patch、dsh.client
├─ cordis.patch.yml        # 插入 include:github-login 这一行
├─ index.js                # Host 侧：路由、凭据、设备码流程、github 工具、传输层
├─ client.js               # 浏览器侧：设置 → GitHub 账号 的设置卡片
├─ locale/en.json|zh.json  # 插件元信息（标题/描述）
└─ icon.svg                # 设置页图标
```

---

## 10. 登录成功后的样子（示例）

- 账号：`<your-github-login>`（id 123456789）
- 令牌类型：经典令牌，`GITHUB_TOKEN` 已写入本机凭据库
- 出口：`http://127.0.0.1:7897`（保存于 `GITHUB_PROXY`；留空即直连）
- 已登录；助手可调用 `github` 工具
