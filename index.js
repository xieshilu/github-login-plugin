/**
 * Host half of `@local/github-login` — GitHub sign-in for the Harness Web UI.
 *
 * Two ways in, both landing in the harness credential store (`GITHUB_TOKEN`):
 *   - a personal access token (classic or fine-grained), validated against `GET /user`;
 *   - GitHub's OAuth device flow, using the Client ID of the user's own OAuth App
 *     (device flow needs no client secret, so nothing secret ships with this plugin).
 *
 * Every GitHub request — login checks, device flow, and the `github` tool — leaves
 * through one transport. When a proxy is configured (`GITHUB_PROXY` stored from the
 * settings page, else the launch environment's `GITHUB_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`)
 * requests tunnel through an HTTP CONNECT proxy; otherwise they go direct.
 *
 * The token is never returned to the browser or to the model. `GET /user` is re-run per
 * operation and the `github` tool resolves the credential for each call, so revoking or
 * replacing the token takes effect on the next request.
 */

import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';

const API_BASE = 'https://api.github.com';
const WEB_BASE = 'https://github.com';
const ROUTE_PREFIX = '/api/dsh-github-login';
const TOKEN_REF = 'GITHUB_TOKEN';
const CLIENT_ID_REF = 'GITHUB_OAUTH_CLIENT_ID';
const PROXY_REF = 'GITHUB_PROXY';
const PROFILE_CACHE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 16 * 1024;
const USER_AGENT = 'dsh-github-login';
/** Device-flow consent is asked for repository work plus the account identity. */
const DEVICE_SCOPES = 'read:user repo';
const TOKEN_PAGE = `${WEB_BASE}/settings/tokens/new?scopes=repo%2Cread%3Auser&description=DeepSeek%20Harness`;
/** The device-code handshake lives here, and this is the page the user approves on. */
const DEVICE_APPROVAL_URL = `${WEB_BASE}/login/device`;

/**
 * Node verifies TLS against its own bundled public roots and ignores the OS store, so a
 * locally trusted TLS-inspecting proxy (a system-installed root) fails here while every
 * browser on the machine works. Trust the OS store whenever the runtime can hand it over.
 */
const SYSTEM_CA = (() => {
  try {
    if (typeof tls.getCACertificates !== 'function') return undefined;
    const list = tls.getCACertificates('system');
    return Array.isArray(list) && list.length > 0 ? list : undefined;
  } catch {
    return undefined;
  }
})();

export const name = 'dsh-github-login';
export const inject = ['webServer'];

/* ------------------------------------------------------------------ credentials */

function credentialStore(ctx) {
  const store = ctx.get('credentials');
  return store && typeof store.resolve === 'function' ? store : undefined;
}

/** Resolve one stored reference; unconfigured, empty, and failing reads all read as absent. */
async function readCredential(ctx, ref) {
  const store = credentialStore(ctx);
  if (!store) return undefined;
  try {
    const resolved = await store.resolve(ref);
    if (!resolved || typeof resolved.value !== 'string' || resolved.value === '') return undefined;
    return { value: resolved.value, source: typeof resolved.source === 'string' ? resolved.source : '' };
  } catch {
    return undefined;
  }
}

async function writeCredential(ctx, ref, value) {
  const store = credentialStore(ctx);
  if (!store || typeof store.set !== 'function') throw new Error('credential-store-unavailable');
  await store.set(ref, value);
}

async function clearCredential(ctx, ref) {
  const store = credentialStore(ctx);
  if (!store || typeof store.unset !== 'function') return;
  try {
    await store.unset(ref);
  } catch {
    /* removing an absent reference is already a no-op */
  }
}

/* ------------------------------------------------------------------ proxy */

function normalizeProxy(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function parseProxy(value) {
  try {
    const url = new URL(normalizeProxy(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!url.hostname) return undefined;
    return {
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      authorization: url.username
        ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
        : '',
    };
  } catch {
    return undefined;
  }
}

/** The proxy in force: the saved value first, then the launch environment. */
async function proxyFor(ctx) {
  const stored = await readCredential(ctx, PROXY_REF);
  if (stored && stored.value.trim()) return { url: normalizeProxy(stored.value), source: 'stored' };
  for (const key of ['GITHUB_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return { url: normalizeProxy(value), source: `env:${key}` };
  }
  return undefined;
}

/**
 * One HTTPS request through an HTTP CONNECT proxy: open the tunnel, wrap it in TLS, then
 * let Node's HTTP client do the framing.
 */
function requestThroughProxy(url, options, proxyValue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let target;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    try {
      target = new URL(url);
      const proxy = parseProxy(proxyValue);
      if (!proxy) {
        finish(reject, new Error('invalid-proxy'));
        return;
      }
      if (target.protocol !== 'https:') {
        finish(reject, new Error('proxy-supports-https-only'));
        return;
      }

      const port = Number(target.port) || 443;
      const socket = net.connect({ host: proxy.host, port: proxy.port });
      const timer = setTimeout(() => {
        socket.destroy();
        finish(reject, new Error('request-timeout'));
      }, REQUEST_TIMEOUT_MS);

      const fail = (error) => {
        clearTimeout(timer);
        socket.destroy();
        finish(reject, error);
      };

      socket.once('error', fail);
      socket.once('connect', () => {
        const head = [`CONNECT ${target.hostname}:${port} HTTP/1.1`, `Host: ${target.hostname}:${port}`];
        if (proxy.authorization) head.push(`Proxy-Authorization: ${proxy.authorization}`);
        socket.write(`${head.join('\r\n')}\r\n\r\n`);
      });

      let handshake = '';
      const onHandshake = (chunk) => {
        handshake += chunk.toString('latin1');
        const end = handshake.indexOf('\r\n\r\n');
        if (end === -1) {
          if (handshake.length > 8192) fail(new Error('proxy-bad-response'));
          return;
        }
        socket.removeListener('data', onHandshake);
        const statusLine = handshake.slice(0, handshake.indexOf('\r\n'));
        if (!/^HTTP\/1\.[01] 2\d\d/.test(statusLine)) {
          fail(new Error(`proxy-refused: ${statusLine}`));
          return;
        }
        const secured = tls.connect({
          socket,
          servername: target.hostname,
          ...(SYSTEM_CA ? { ca: SYSTEM_CA } : {}),
        });
        secured.once('error', fail);
        secured.once('secureConnect', () => {
          clearTimeout(timer);
          sendRequest(secured, url, options).then((result) => finish(resolve, result), fail);
        });
      };
      socket.on('data', onHandshake);
    } catch (error) {
      finish(reject, error);
    }
  });
}

/** Send one request over an already-secured socket (the tunnel's TLS, or a direct one). */
function sendRequest(socket, url, options) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    // TLS is already terminated here, so the http request rides the established socket.
    // The socket belongs to the agent: `agent: false` would build a default agent that
    // ignores createConnection and dials 443 again, outside the socket we hand it.
    const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
    agent.createConnection = () => socket;
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    const request = http.request(
      {
        host: target.hostname,
        port: Number(target.port) || 443,
        path: `${target.pathname}${target.search}`,
        method: (options.method || 'GET').toUpperCase(),
        headers: { host: target.hostname, 'user-agent': USER_AGENT, ...(options.headers || {}) },
        agent,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', fail);
        response.on('end', () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('request-timeout')));
    request.once('error', fail);
    if (options.body !== undefined && options.body !== null) request.write(options.body);
    request.end();
  });
}

/** No proxy configured: dial GitHub directly, still verifying against the OS trust store. */
function requestDirect(url, options) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      reject(new Error('https-only'));
      return;
    }
    const socket = tls.connect({
      host: target.hostname,
      port: Number(target.port) || 443,
      servername: target.hostname,
      ...(SYSTEM_CA ? { ca: SYSTEM_CA } : {}),
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('request-timeout'));
    }, REQUEST_TIMEOUT_MS);
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      sendRequest(socket, url, options).then(resolve, reject);
    });
  });
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

/** One transport for every GitHub call, so a configured proxy cannot be bypassed. */
async function requestJson(ctx, url, options) {
  const proxy = await proxyFor(ctx);
  const result = proxy
    ? await requestThroughProxy(url, options, proxy.url)
    : await requestDirect(url, options);
  return {
    response: { ok: result.ok, status: result.status, headers: result.headers },
    data: parseBody(result.text),
  };
}

/* ------------------------------------------------------------------ GitHub HTTP */

function githubHeaders(token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': USER_AGENT,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/** Call one REST path; `path` may be relative (`repos/octocat/Hello-World`) or absolute. */
async function githubCall(ctx, token, path, init = {}) {
  const relative = typeof path === 'string' ? path.trim() : '';
  if (!relative) throw new Error('path-required');
  const url = /^https?:\/\//i.test(relative)
    ? relative
    : `${API_BASE}${relative.startsWith('/') ? '' : '/'}${relative}`;
  const headers = { ...githubHeaders(token), ...(init.headers || {}) };
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody) headers['content-type'] = 'application/json';
  const { response, data } = await requestJson(ctx, url, {
    method: (init.method || 'GET').toUpperCase(),
    headers,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  return { response, data };
}

function pickString(value) {
  return typeof value === 'string' ? value : '';
}

/** Validate one token against `GET /user` and describe the account it belongs to. */
async function fetchProfile(ctx, token) {
  try {
    const { response, data } = await githubCall(ctx, token, '/user');
    if (!response.ok) {
      const message = data && typeof data.message === 'string' ? data.message : `HTTP ${response.status}`;
      return { ok: false, status: response.status, error: message };
    }
    if (!data || typeof data.login !== 'string') {
      return { ok: false, status: response.status, error: 'unexpected-response' };
    }
    const scopeHeader = response.headers.get('x-oauth-scopes');
    return {
      ok: true,
      status: response.status,
      user: {
        id: typeof data.id === 'number' ? data.id : null,
        login: data.login,
        name: pickString(data.name),
        avatarUrl: pickString(data.avatar_url),
        htmlUrl: pickString(data.html_url),
        company: pickString(data.company),
        location: pickString(data.location),
      },
      scopes: scopeHeader === null ? [] : scopeHeader.split(',').map((entry) => entry.trim()).filter(Boolean),
      tokenKind: scopeHeader === null ? 'fine-grained' : 'classic',
      checkedAt: Date.now(),
    };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : 'network-error' };
  }
}

/* ------------------------------------------------------------------ device flow */

async function startDeviceFlow(ctx, clientId) {
  const { response, data } = await requestJson(ctx, `${WEB_BASE}/login/device/code`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ client_id: clientId, scope: DEVICE_SCOPES }),
  });
  if (!response.ok || !data || typeof data.device_code !== 'string' || typeof data.user_code !== 'string') {
    const reason =
      (data && (pickString(data.error_description) || pickString(data.error))) || `HTTP ${response.status}`;
    return { ok: false, error: reason };
  }
  return {
    ok: true,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: pickString(data.verification_uri) || DEVICE_APPROVAL_URL,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 900,
    interval: typeof data.interval === 'number' ? data.interval : 5,
  };
}

async function pollDeviceFlow(ctx, clientId, deviceCode) {
  const { response, data } = await requestJson(ctx, `${WEB_BASE}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  if (data && typeof data.access_token === 'string' && data.access_token !== '') {
    return { status: 'authorized', token: data.access_token };
  }
  const code = data && typeof data.error === 'string' ? data.error : `http-${response.status}`;
  if (code === 'authorization_pending') return { status: 'pending' };
  if (code === 'slow_down') return { status: 'slow_down' };
  if (code === 'expired_token') return { status: 'expired' };
  if (code === 'access_denied') return { status: 'denied' };
  return { status: 'error', error: (data && pickString(data.error_description)) || code };
}

/* ------------------------------------------------------------------ HTTP plumbing */

function respond(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res) {
  respond(res, 405, { error: 'method-not-allowed' });
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error('body-too-large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body-must-be-object');
  return parsed;
}

function describeError(error) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'request-timeout';
    return error.message;
  }
  return 'unexpected-error';
}

/* ------------------------------------------------------------------ status payload */

/**
 * The one description of the sign-in state that both the page and the tool read.
 * Contains the account, where the token came from, and the proxy in force — never the token.
 */
async function buildStatus(ctx, state, force) {
  const clientIdRecord = await readCredential(ctx, CLIENT_ID_REF);
  const proxy = await proxyFor(ctx);
  const base = {
    signedIn: false,
    clientId: clientIdRecord ? clientIdRecord.value : '',
    proxy: proxy ? proxy.url : '',
    proxySource: proxy ? proxy.source : '',
    tokenUrl: TOKEN_PAGE,
    tokenSource: '',
    user: null,
    scopes: [],
    tokenKind: '',
  };

  const tokenRecord = await readCredential(ctx, TOKEN_REF);
  if (!tokenRecord) return base;

  const cached =
    !force && state.profile && state.profile.token === tokenRecord.value && Date.now() - state.profile.at < PROFILE_CACHE_MS;
  const profile = cached ? state.profile.value : await fetchProfile(ctx, tokenRecord.value);
  if (!cached) state.profile = { token: tokenRecord.value, at: Date.now(), value: profile };

  if (!profile.ok) {
    return {
      ...base,
      invalidToken: true,
      tokenSource: tokenRecord.source,
      error: profile.error,
      status: profile.status,
    };
  }
  return {
    ...base,
    signedIn: true,
    tokenSource: tokenRecord.source,
    user: profile.user,
    scopes: profile.scopes,
    tokenKind: profile.tokenKind,
    verifiedAt: new Date(profile.checkedAt).toISOString(),
  };
}

/* ------------------------------------------------------------------ the `github` tool */

const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['whoami', 'request'],
      description: "whoami: return the signed-in GitHub account. request: perform one GitHub REST call with method/path/body.",
    },
    method: {
      type: 'string',
      enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      description: 'HTTP method for action=request. Defaults to GET.',
    },
    path: {
      type: 'string',
      description:
        "GitHub REST path without the https://api.github.com prefix, e.g. 'repos/octocat/Hello-World/issues' or '/user/repos'.",
    },
    body: {
      type: 'object',
      description: 'JSON body for POST/PATCH/PUT. Omit for GET and DELETE.',
    },
  },
  required: ['action'],
  additionalProperties: false,
};

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'Whether the call succeeded.' },
    error: { type: 'string', description: 'Failure reason when ok is false.' },
    status: { type: 'number', description: 'HTTP status GitHub returned, when a request was made.' },
    user: { type: 'object', description: 'The signed-in account, for action=whoami.' },
    scopes: { type: 'array', items: { type: 'string' }, description: 'OAuth scopes attached to the token.' },
    data: { description: 'Parsed JSON body returned by GitHub.' },
  },
  required: ['ok'],
};

function renderToolResult(_args, value) {
  let text;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (typeof text !== 'string') text = String(text);
  const LIMIT = 12_000;
  if (text.length > LIMIT) text = `${text.slice(0, LIMIT)}\n... (truncated, ${text.length - LIMIT} more characters)`;
  return [{ type: 'text', text }];
}

function createGithubTool(ctx) {
  return {
    name: 'github',
    description:
      'Call the GitHub REST API as the user signed in through Settings -> GitHub. Use action "whoami" to see which account is signed in, and action "request" for one call, e.g. { action: "request", method: "GET", path: "repos/octocat/Hello-World/issues" }. The access token stays in the harness credential store and is never returned. If the result says not-signed-in, ask the user to sign in from Settings -> GitHub; never ask for their token in chat.',
    parameters: TOOL_PARAMETERS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: renderToolResult,
    },
    timeoutMs: 30_000,
    async execute(args) {
      const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
      const action = typeof input.action === 'string' && input.action !== '' ? input.action : 'whoami';

      const tokenRecord = await readCredential(ctx, TOKEN_REF);
      if (!tokenRecord) {
        return {
          ok: false,
          error: 'not-signed-in',
          hint: 'Ask the user to sign in from Settings -> GitHub in the Harness Web UI.',
        };
      }

      if (action === 'whoami') {
        const profile = await fetchProfile(ctx, tokenRecord.value);
        if (!profile.ok) return { ok: false, status: profile.status, error: profile.error };
        return { ok: true, status: profile.status, user: profile.user, scopes: profile.scopes };
      }

      if (action === 'request') {
        if (typeof input.path !== 'string' || input.path.trim() === '') {
          return { ok: false, error: 'path-required', hint: "Give a path such as 'user/repos'." };
        }
        const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
        const allowed = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
        if (!allowed.includes(method)) return { ok: false, error: 'method-not-supported' };
        const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body) ? input.body : undefined;
        if ((method === 'GET' || method === 'DELETE') && body !== undefined) {
          return { ok: false, error: 'body-not-allowed-for-method' };
        }
        try {
          const { response, data } = await githubCall(ctx, tokenRecord.value, input.path, { method, body });
          if (!response.ok) {
            const message = data && typeof data.message === 'string' ? data.message : `HTTP ${response.status}`;
            return { ok: false, status: response.status, error: message, data };
          }
          return { ok: true, status: response.status, data };
        } catch (error) {
          return { ok: false, error: describeError(error) };
        }
      }

      return { ok: false, error: 'unknown-action' };
    },
  };
}

/* ------------------------------------------------------------------ plugin entry */

export function apply(ctx) {
  const state = { profile: null };
  /** One attempt per flow id; the device code itself never leaves the Host. */
  const flows = new Map();

  const dropFlow = (flowId) => {
    if (typeof flowId === 'string') flows.delete(flowId);
  };

  const handlers = {
    async status(req, res) {
      if (req.method !== 'GET') return methodNotAllowed(res);
      respond(res, 200, await buildStatus(ctx, state, false));
    },

    async token(req, res) {
      if (req.method !== 'POST') return methodNotAllowed(res);
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return respond(res, 400, { error: describeError(error) });
      }
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      if (!token) return respond(res, 400, { error: 'token-required' });
      if (token.length > 512) return respond(res, 400, { error: 'token-too-long' });

      const profile = await fetchProfile(ctx, token);
      if (!profile.ok) {
        return respond(res, 400, {
          error: profile.error,
          status: profile.status,
          hint: 'Check that the token is valid and has not expired, then paste it again.',
        });
      }
      await writeCredential(ctx, TOKEN_REF, token);
      state.profile = { token, at: Date.now(), value: profile };
      respond(res, 200, await buildStatus(ctx, state, true));
    },

    async logout(req, res) {
      if (req.method !== 'POST') return methodNotAllowed(res);
      const before = await readCredential(ctx, TOKEN_REF);
      await clearCredential(ctx, TOKEN_REF);
      state.profile = null;
      const after = await readCredential(ctx, TOKEN_REF);
      const payload = await buildStatus(ctx, state, true);
      respond(res, 200, {
        ...payload,
        removedFromStore: Boolean(before),
        stillFromEnvironment: Boolean(after),
      });
    },

    async network(req, res) {
      if (req.method !== 'GET') return methodNotAllowed(res);
      const proxy = await proxyFor(ctx);
      respond(res, 200, { proxy: proxy ? proxy.url : '', proxySource: proxy ? proxy.source : '' });
    },

    async networkSave(req, res) {
      if (req.method !== 'POST') return methodNotAllowed(res);
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return respond(res, 400, { error: describeError(error) });
      }
      const raw = typeof body.proxy === 'string' ? body.proxy.trim() : '';
      if (raw === '') {
        await clearCredential(ctx, PROXY_REF);
      } else {
        const normalized = normalizeProxy(raw);
        if (!parseProxy(normalized)) return respond(res, 400, { error: 'invalid-proxy' });
        await writeCredential(ctx, PROXY_REF, normalized);
      }
      const proxy = await proxyFor(ctx);
      respond(res, 200, { proxy: proxy ? proxy.url : '', proxySource: proxy ? proxy.source : '' });
    },

    /** Answer the two questions that decide whether sign-in can work at all. */
    async networkTest(req, res) {
      if (req.method !== 'POST') return methodNotAllowed(res);
      const targets = [
        { key: 'api', url: `${API_BASE}/zen`, expectOk: true },
        // Any HTTP answer proves github.com is reachable; `/login/device` only answers POST.
        { key: 'web', url: WEB_BASE, expectOk: false },
      ];
      const checks = {};
      for (const target of targets) {
        const started = Date.now();
        try {
          const { response } = await requestJson(ctx, target.url, {
            method: 'GET',
            headers: { accept: 'application/json' },
          });
          checks[target.key] = {
            ok: target.expectOk ? response.ok : response.status > 0,
            status: response.status,
            ms: Date.now() - started,
          };
        } catch (error) {
          checks[target.key] = { ok: false, status: 0, ms: Date.now() - started, error: describeError(error) };
        }
      }
      const proxy = await proxyFor(ctx);
      respond(res, 200, { proxy: proxy ? proxy.url : '', proxySource: proxy ? proxy.source : '', checks });
    },

    async deviceStart(req, res) {
      if (req.method !== 'POST') return methodNotAllowed(res);
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return respond(res, 400, { error: describeError(error) });
      }
      const typed = typeof body.clientId === 'string' ? body.clientId.trim() : '';
      const stored = await readCredential(ctx, CLIENT_ID_REF);
      const clientId = typed || (stored ? stored.value : '');
      if (!clientId) return respond(res, 400, { error: 'client-id-required' });

      let started;
      try {
        started = await startDeviceFlow(ctx, clientId);
      } catch (error) {
        return respond(res, 502, { error: 'oauth-unreachable', detail: describeError(error) });
      }
      if (!started.ok) return respond(res, 400, { error: started.error });

      try {
        if (!stored || stored.value !== clientId) await writeCredential(ctx, CLIENT_ID_REF, clientId);
      } catch {
        /* remembering the client id is a convenience, not a requirement */
      }

      for (const [id, flow] of flows) {
        if (Date.now() > flow.expiresAt) flows.delete(id);
      }
      const flowId = globalThis.crypto.randomUUID();
      flows.set(flowId, {
        clientId,
        deviceCode: started.deviceCode,
        expiresAt: Date.now() + started.expiresIn * 1000,
        interval: started.interval,
      });
      respond(res, 200, {
        flowId,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        expiresIn: started.expiresIn,
        interval: started.interval,
      });
    },

    async devicePoll(req, res) {
      if (req.method !== 'POST') return methodNotAllowed(res);
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return respond(res, 400, { error: describeError(error) });
      }
      const flowId = typeof body.flowId === 'string' ? body.flowId : '';
      const flow = flows.get(flowId);
      if (!flow) return respond(res, 200, { status: 'expired' });
      if (Date.now() > flow.expiresAt) {
        flows.delete(flowId);
        return respond(res, 200, { status: 'expired' });
      }

      const result = await pollDeviceFlow(ctx, flow.clientId, flow.deviceCode).catch(() => ({
        status: 'error',
        error: 'oauth-unreachable',
      }));
      if (result.status === 'pending') {
        return respond(res, 200, { status: 'pending', interval: flow.interval });
      }
      if (result.status === 'slow_down') {
        flow.interval += 5;
        return respond(res, 200, { status: 'slow_down', interval: flow.interval });
      }
      if (result.status !== 'authorized') {
        if (result.status === 'expired' || result.status === 'denied') flows.delete(flowId);
        return respond(res, 200, { status: result.status, error: result.error });
      }

      flows.delete(flowId);
      const profile = await fetchProfile(ctx, result.token);
      if (!profile.ok) {
        return respond(res, 200, { status: 'error', error: profile.error || 'token-validation-failed' });
      }
      await writeCredential(ctx, TOKEN_REF, result.token);
      state.profile = { token: result.token, at: Date.now(), value: profile };
      respond(res, 200, { status: 'authorized' });
    },

    async deviceCancel(req, res) {
      if (req.method !== 'POST') return methodNotAllowed(res);
      try {
        const body = await readJsonBody(req);
        dropFlow(typeof body.flowId === 'string' ? body.flowId : '');
      } catch {
        /* a malformed cancel request still ends that attempt */
      }
      respond(res, 200, { status: 'cancelled' });
    },
  };

  /** Route segment -> handler. The segment is the URL, not the handler's name. */
  const routes = {
    status: handlers.status,
    token: handlers.token,
    logout: handlers.logout,
    network: handlers.network,
    'network/save': handlers.networkSave,
    'network/test': handlers.networkTest,
    'device/start': handlers.deviceStart,
    'device/poll': handlers.devicePoll,
    'device/cancel': handlers.deviceCancel,
  };

  for (const [segment, handler] of Object.entries(routes)) {
    const path = `${ROUTE_PREFIX}/${segment}`;
    // A handler that throws must still answer with JSON; an empty reply hides the cause.
    const guarded = async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (ctx.logger && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn(`github-login: ${path} failed: ${describeError(error)}`);
        }
        if (!res.headersSent && !res.writableEnded) {
          respond(res, 500, { error: describeError(error) });
          return;
        }
        try {
          res.end();
        } catch {
          /* the peer is already gone */
        }
      }
    };
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path, handler: guarded }),
      `github-login: ${path}`,
    );
  }

  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(
      () => toolsCtx.tools.register(createGithubTool(ctx)),
      'github-login: github tool',
    );
  });
}
