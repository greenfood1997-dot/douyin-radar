export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword, token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  // App V3 API 专为服务器端调用设计，不会有 400 问题
  const urls = [
    `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_search_video?keyword=${encodeURIComponent(keyword||'美食')}&cursor=0&count=20&sort_type=1&publish_time=1`,
    `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_video_feed?count=20`,
    `https://api.tikhub.io/api/v1/douyin/app/v2/fetch_search_video?keyword=${encodeURIComponent(keyword||'美食')}&cursor=0&count=20`,
  ];

  const errors = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        }
      });
      const text = await r.text();
      // 返回原始响应供调试
      return res.status(200).send(text);
    } catch(e) {
      errors.push(e.message);
    }
  }
  return res.status(500).json({ errors });
}
