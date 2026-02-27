export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword') || '美食';
  const token = searchParams.get('token');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (!token) return new Response(JSON.stringify({ error: 'Missing token' }), { headers });

  const urls = [
    `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_search_video?keyword=${encodeURIComponent(keyword)}&cursor=0&count=20&sort_type=1&publish_time=1`,
    `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_video_feed?count=20`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        }
      });
      const text = await r.text();
      return new Response(text, { headers });
    } catch(e) {
      continue;
    }
  }
  return new Response(JSON.stringify({ error: 'All endpoints failed' }), { headers });
}
