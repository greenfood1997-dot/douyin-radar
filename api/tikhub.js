export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const keyword  = searchParams.get('keyword') || '美食';
  const token    = searchParams.get('token');
  const endpoint = searchParams.get('endpoint') || 'search';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key,anthropic-version',
    'Content-Type': 'application/json',
  };

  // ── 处理 OPTIONS 预检请求 ────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // ── 处理 POST：前端把 Anthropic 请求转发到此处，服务端转发给 Anthropic ──
  if (req.method === 'POST') {
    const anthropicKey = req.headers.get('x-anthropic-key') || req.headers.get('authorization')?.replace('Bearer ','');
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Missing Anthropic API Key' }), { status: 400, headers: cors });
    }
    try {
      const body = await req.text();
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      });
      const data = await upstream.text();
      return new Response(data, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
    }
  }

  // ── GET：TikHub 抖音数据获取 ─────────────────────────────────────
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token', code: 400 }), { status: 400, headers: cors });
  }

  const tikhubHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  // 尝试多个 TikHub 端点
  const urls = endpoint === 'hot'
    ? [
        `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_video_feed?count=20`,
        `https://api.tikhub.io/api/v1/douyin/web/fetch_hot_search_list`,
      ]
    : [
        `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_search_video?keyword=${encodeURIComponent(keyword)}&cursor=0&count=20&sort_type=1&publish_time=0`,
        `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_search_video?keyword=${encodeURIComponent(keyword)}&cursor=0&count=20&sort_type=0`,
      ];

  let lastError = '';
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: tikhubHeaders, signal: controller.signal });
      if (r.status === 401) {
        clearTimeout(timeout);
        return new Response(JSON.stringify({ error: 'TikHub Key 无效（401），请检查 Key 是否正确', code: 401 }), { status: 401, headers: cors });
      }
      if (r.status === 402 || r.status === 403) {
        clearTimeout(timeout);
        return new Response(JSON.stringify({ error: 'TikHub 账户余额不足或权限不够，请充值后重试', code: r.status }), { status: r.status, headers: cors });
      }
      if (!r.ok) { lastError = `HTTP ${r.status}`; continue; }
      const text = await r.text();
      clearTimeout(timeout);
      return new Response(text, { headers: cors });
    } catch (e) {
      if (e.name === 'AbortError') break;
      lastError = e.message;
    }
  }

  clearTimeout(timeout);
  return new Response(JSON.stringify({ error: `所有端点均失败: ${lastError}`, code: 500 }), { status: 500, headers: cors });
}
