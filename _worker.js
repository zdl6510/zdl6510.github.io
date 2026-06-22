const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*'
};

const upstreamApis = [
  qq => `https://uapis.cn/api/v1/social/qq/userinfo?qq=${encodeURIComponent(qq)}`,
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

async function fetchQQNick(qq) {
  for (const getUrl of upstreamApis) {
    try {
      const response = await fetch(getUrl(qq), {
        headers: {
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
        }
      });
      const text = await response.text();

      if (!response.ok || /^\s*</.test(text)) continue;

      const data = JSON.parse(text);
      const nickname = pickNick(data);
      if (nickname) return nickname;
    } catch (error) {}
  }

  return '';
}

async function handleQQInfo(request) {
  const url = new URL(request.url);
  const qq = (url.searchParams.get('qq') || '').trim();

  if (!/^[1-9]\d{4,11}$/.test(qq)) {
    return new Response(JSON.stringify({ error: 'invalid_qq' }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  try {
    const nickname = await fetchQQNick(qq);

    return new Response(JSON.stringify({
      qq,
      nickname: nickname || '',
      nick: nickname || '',
      email: `${qq}@qq.com`
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
