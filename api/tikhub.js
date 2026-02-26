export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword, endpoint, token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  let url;
  if (endpoint === 'hot') {
    url = 'https://api.tikhub.io/api/v1/douyin/web/fetch_hot_video?count=20';
  } else {
    url = `https://api.tikhub.io/api/v1/douyin/web/fetch_video_search_result?keyword=${encodeURIComponent(keyword||'美食')}&offset=0&count=20&sort_type=1&publish_time=1`;
  }

  try {
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const data = await r.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
