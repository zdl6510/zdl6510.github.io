const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*'
};
const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_MAX_CHARS = 6000;
const DEFAULT_AI_CACHE_SECONDS = 86400;

function getUapisUrl(qq) {
  return `https://uapis.cn/api/v1/social/qq/userinfo?qq=${encodeURIComponent(qq)}`;
}

function fillProxyUrl(template, qq) {
  const proxy = String(template || '').trim();
  if (!proxy) return '';

  const uapisUrl = getUapisUrl(qq);
  if (proxy.includes('{rawUrl}')) return proxy.replaceAll('{rawUrl}', uapisUrl).replaceAll('{qq}', encodeURIComponent(qq));
  if (proxy.includes('{url}')) return proxy.replaceAll('{url}', encodeURIComponent(uapisUrl)).replaceAll('{qq}', encodeURIComponent(qq));
  if (proxy.includes('{qq}')) return proxy.replaceAll('{qq}', encodeURIComponent(qq));

  const separator = proxy.includes('?') ? '&' : '?';
  return `${proxy}${separator}qq=${encodeURIComponent(qq)}`;
}

function getUpstreamUrls(qq, env = {}) {
  const proxyTemplates = [
    env.QQINFO_PROXY_URLS,
    env.QQINFO_PROXY_URL
  ].filter(Boolean).flatMap(item => String(item).split(','));
  const proxyUrls = proxyTemplates.map(template => fillProxyUrl(template, qq)).filter(Boolean);

  return [
    ...proxyUrls,
    getUapisUrl(qq)
  ];
}

function pickNick(data) {
  if (!data) return '';

  const candidates = [
    data.nickname,
    data.nick,
    data.name,
    data.qqname,
    data.user,
    data.data && data.data.nickname,
    data.data && data.data.nick,
    data.data && data.data.name,
    data.data && data.data.qqname,
    data.result && data.result.nickname,
    data.result && data.result.nick,
    data.result && data.result.name
  ];

  const nick = candidates.find(item => typeof item === 'string' && item.trim());
  return nick ? nick.trim() : '';
}

async function fetchQQNick(qq, debug = false, env = {}) {
  const attempts = [];

  for (const requestUrl of getUpstreamUrls(qq, env)) {
    try {
      const response = await fetch(requestUrl, {
        headers: {
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://uapis.cn/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
        }
      });
      const text = await response.text();
      const attempt = {
        url: requestUrl,
        status: response.status,
        ok: response.ok,
        textPrefix: text.slice(0, 220)
      };

      if (!response.ok || /^\s*</.test(text)) {
        attempts.push(attempt);
        continue;
      }

      const data = JSON.parse(text);
      const nickname = pickNick(data);
      attempt.nickname = nickname;
      attempts.push(attempt);
      if (nickname) {
        return {
          nickname,
          source: requestUrl,
          attempts: debug ? attempts : undefined
        };
      }
    } catch (error) {
      attempts.push({
        url: requestUrl,
        error: error && error.message ? error.message : 'fetch_failed'
      });
    }
  }

  return {
    nickname: '',
    source: '',
    attempts: debug ? attempts : undefined
  };
}

async function handleQQInfo(request, env = {}) {
  const url = new URL(request.url);
  const qq = (url.searchParams.get('qq') || '').trim();
  const debug = url.searchParams.get('debug') === '1';

  if (!/^[1-9]\d{4,11}$/.test(qq)) {
    return new Response(JSON.stringify({ error: 'invalid_qq' }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  try {
    const result = await fetchQQNick(qq, debug, env);
    const nickname = result.nickname || '';

    return new Response(JSON.stringify({
      qq,
      nickname,
      nick: nickname,
      email: `${qq}@qq.com`,
      source: result.source,
      debug: debug ? result.attempts : undefined
    }), {
      status: 200,
      headers: jsonHeaders
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'qqinfo_fetch_failed' }), {
      status: 502,
      headers: jsonHeaders
    });
  }
}

async function handleAiSummary(request, env = {}) {
  const corsHeaders = getAiCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, {
      ...corsHeaders,
      'Allow': 'POST, OPTIONS'
    });
  }

  try {
    const body = await readJson(request);
    const content = String(body.content || '').trim();
    const title = String(body.title || '').trim();
    const url = String(body.url || '').trim();

    if (!content) return jsonResponse({ error: 'missing_content' }, 400, corsHeaders);

    const apiKey = String(env.AI_SUMMARY_API_KEY || '').trim();
    if (!apiKey) return jsonResponse({ error: 'missing_ai_summary_api_key' }, 500, corsHeaders);

    const baseUrl = normalizeBaseUrl(env.AI_SUMMARY_BASE_URL || DEFAULT_AI_BASE_URL);
    const model = String(env.AI_SUMMARY_MODEL || DEFAULT_AI_MODEL).trim();
    const maxChars = toPositiveInt(env.AI_SUMMARY_MAX_CHARS, DEFAULT_AI_MAX_CHARS);
    const cacheSeconds = toPositiveInt(env.AI_SUMMARY_CACHE_SECONDS, DEFAULT_AI_CACHE_SECONDS);
    const clippedContent = content.slice(0, maxChars);
    const cacheKey = await createAiCacheKey(request.url, model, title, url, clippedContent);

    if (cacheSeconds > 0 && typeof caches !== 'undefined' && caches.default) {
      const cached = await caches.default.match(cacheKey);
      if (cached) return withCors(cached, corsHeaders);
    }

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: Number(env.AI_SUMMARY_TEMPERATURE || 0.4),
        messages: [
          {
            role: 'system',
            content: '你是博客文章摘要助手。请用中文输出一段自然、准确、有帮助的文章摘要。不要编造原文没有的信息，不要使用 Markdown 列表。控制在 120 到 220 字。'
          },
          {
            role: 'user',
            content: [
              title ? `标题：${title}` : '',
              url ? `链接：${url}` : '',
              `正文：${clippedContent}`
            ].filter(Boolean).join('\n\n')
          }
        ]
      })
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return jsonResponse({
        error: 'ai_summary_upstream_failed',
        status: upstream.status,
        detail: safeJsonError(text)
      }, 502, corsHeaders);
    }

    const data = JSON.parse(text);
    const summary = String(data.choices?.[0]?.message?.content || '').trim();
    if (!summary) return jsonResponse({ error: 'empty_summary' }, 502, corsHeaders);

    const response = jsonResponse({
      summary,
      id: await sha256(`${model}:${title}:${url}:${clippedContent}`),
      model,
      cached: false
    }, 200, {
      ...corsHeaders,
      'Cache-Control': `public, max-age=${cacheSeconds}`
    });

    if (cacheSeconds > 0 && typeof caches !== 'undefined' && caches.default) {
      await caches.default.put(cacheKey, response.clone());
    }

    return response;
  } catch (error) {
    return jsonResponse({
      error: 'ai_summary_failed',
      detail: error && error.message ? error.message : 'unknown_error'
    }, 500, corsHeaders);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

function withCors(response, corsHeaders) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  headers.set('X-AI-Summary-Cache', 'HIT');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function getAiCorsHeaders(request, env = {}) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = String(env.AI_SUMMARY_ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  const allowOrigin = allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : origin;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin'
  };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_AI_BASE_URL).trim().replace(/\/+$/, '');
}

function toPositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function safeJsonError(text) {
  try {
    const data = JSON.parse(text);
    return data.error?.message || data.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

async function createAiCacheKey(requestUrl, model, title, url, content) {
  const keyUrl = new URL(requestUrl);
  keyUrl.search = '';
  keyUrl.pathname = `/api/ai-summary/cache/${await sha256(`${model}:${title}:${url}:${content}`)}`;
  return new Request(keyUrl.toString(), { method: 'GET' });
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/ai-summary') {
      return handleAiSummary(request, env);
    }

    if (url.pathname === '/api/qqinfo') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: {
            ...jsonHeaders,
            'Allow': 'GET, HEAD, OPTIONS'
          }
        });
      }

      return handleQQInfo(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
