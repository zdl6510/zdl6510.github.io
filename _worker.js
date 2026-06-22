const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
  'Access-Control-Allow-Origin': '*'
};

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
    const upstream = await fetch(`https://uapis.cn/api/v1/social/qq/userinfo?qq=${encodeURIComponent(qq)}`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    return new Response(await upstream.text(), {
      status: upstream.ok ? 200 : upstream.status,
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
