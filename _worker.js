const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*'
};

const upstreamApis = [
  qq => `https://uapis.cn/api/v1/social/qq/userinfo?qq=${encodeURIComponent(qq)}`,
  qq => `https://tmini.net/api/qqinfos?qq=${encodeURIComponent(qq)}&type=json`,
  qq => `https://api.lolimi.cn/API/qqxx/api.php?qq=${encodeURIComponent(qq)}`,
  qq => `https://tenapi.cn/v2/qqinfo?qq=${encodeURIComponent(qq)}`,
  qq => `https://api.vvhan.com/api/qq?qq=${encodeURIComponent(qq)}`
];

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

async function fetchQQNick(qq, debug = false) {
  const attempts = [];

  for (const getUrl of upstreamApis) {
    const requestUrl = getUrl(qq);
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

async function handleQQInfo(request) {
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
    const result = await fetchQQNick(qq, debug);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

      return handleQQInfo(request);
    }

    return env.ASSETS.fetch(request);
  }
};
