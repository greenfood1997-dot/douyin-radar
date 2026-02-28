module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyword = req.query.keyword || '美食';
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const url = `https://api.tikhub.io/api/v1/douyin/app/v3/fetch_search_video?keyword=${encodeURIComponent(keyword)}&cursor=0&count=20&sort_type=1`;

  try {
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const text = await r.text();
    res.status(200).send(text);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
