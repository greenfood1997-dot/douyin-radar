export const config = { runtime: 'edge' };

const BASE = 'https://api.tikhub.io';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key,anthropic-version',
  'Content-Type': 'application/json',
};

function ok(data) {
  return new Response(JSON.stringify({ success: true, ...data }), { status: 200, headers: CORS });
}
function err(msg, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), { status, headers: CORS });
}

// 尝试多个 URL，返回第一个成功且有数据的结果
async function tryUrls(urls, token, pick) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const json = await res.json();
      const items = pick(json);
      if (items && items.length > 0) return { items, _raw: json };
    } catch (e) {
      continue;
    }
  }
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint') || 'hot_search';
  const keyword  = searchParams.get('keyword') || '';
  const uniqueId = searchParams.get('unique_id') || '';

  const token = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return err('Missing TikHub API Key');

  try {

    // ══════════════════════════════════════════════════════
    // 热搜榜：多接口 fallback（优先 App V3）
    // ══════════════════════════════════════════════════════
    if (endpoint === 'hot_search') {
      const result = await tryUrls([
        `${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`,
        `${BASE}/api/v1/douyin/app/v2/fetch_hot_search_list`,
        `${BASE}/api/v1/douyin/app/v1/fetch_hot_search_list`,
        `${BASE}/api/v1/douyin/web/fetch_hot_search_list`,
      ], token, (json) =>
        json?.data?.word_list ||
        json?.data?.sentence_list ||
        json?.data?.data ||
        (Array.isArray(json?.data) ? json.data : null)
      );

      if (!result) return ok({
        type: 'hot_search', title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'), items: [],
        _debug: 'all endpoints returned empty'
      });

      return ok({
        type: 'hot_search',
        title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: result.items.map((item, idx) => ({
          rank: idx + 1,
          word: item.word || item.sentence || item.hot_value_desc || item.title || item.name || '',
          hotValue: item.hot_value || item.event_count || item.hot_score || 0,
          label: item.label_name || item.sentence_label || item.label || '',
          coverUrl: item.cover_url || item.cover?.url_list?.[0] || '',
        })),
      });
    }

    // ══════════════════════════════════════════════════════
    // 关键词搜索视频：多接口 fallback
    // ══════════════════════════════════════════════════════
    else if (endpoint === 'search') {
      if (!keyword) return err('请提供 keyword 参数');

      const kw = encodeURIComponent(keyword);
      const result = await tryUrls([
        `${BASE}/api/v1/douyin/app/v3/fetch_search_result?keyword=${kw}&count=20&offset=0&search_id=&sort_type=0&publish_time=0&filter_duration=0`,
        `${BASE}/api/v1/douyin/app/v2/fetch_search_result?keyword=${kw}&count=20&offset=0`,
        `${BASE}/api/v1/douyin/web/fetch_video_search_result?keyword=${kw}&count=20&offset=0&sort_type=0&publish_time=0`,
      ], token, (json) =>
        json?.data?.data ||
        json?.data?.aweme_list ||
        json?.data?.video_list ||
        (Array.isArray(json?.data) ? json.data : null)
      );

      if (!result) return ok({ type: 'search', keyword, title: `"${keyword}" 搜索结果`, updateTime: new Date().toLocaleString('zh-CN'), items: [] });

      return ok({
        type: 'search',
        keyword,
        title: `"${keyword}" 搜索结果`,
        updateTime: new Date().toLocaleString('zh-CN'),
        items: result.items.map(item => {
          const v = item.aweme_info || item;
          const stat = v.statistics || v.stats || {};
          return {
            awemeId: v.aweme_id || v.id || '',
            desc: v.desc || v.title || '',
            author: v.author?.nickname || v.author?.name || '',
            authorId: v.author?.unique_id || v.author?.uid || '',
            coverUrl: v.video?.cover?.url_list?.[0] || v.cover_url || '',
            playCount: parseInt(stat.play_count || stat.playCount || 0),
            diggCount: parseInt(stat.digg_count || stat.like_count || 0),
            commentCount: parseInt(stat.comment_count || 0),
            shareCount: parseInt(stat.share_count || 0),
            createTime: v.create_time ? new Date(v.create_time * 1000).toLocaleDateString('zh-CN') : '',
          };
        }),
      });
    }

    // ══════════════════════════════════════════════════════
    // 达人信息
    // ══════════════════════════════════════════════════════
    else if (endpoint === 'user_info') {
      if (!uniqueId) return err('请提供 unique_id 参数（抖音号）');

      const uid = encodeURIComponent(uniqueId);
      const result = await tryUrls([
        `${BASE}/api/v1/douyin/app/v3/fetch_user_info?unique_id=${uid}`,
        `${BASE}/api/v1/douyin/web/fetch_user_info?unique_id=${uid}`,
        `${BASE}/api/v1/douyin/app/v2/fetch_user_info?unique_id=${uid}`,
      ], token, (json) => {
        const u = json?.data?.user || json?.data;
        return u?.uid || u?.nickname ? [u] : null;
      });

      if (!result) return err('未找到该用户');
      const u = result.items[0];
      return ok({
        type: 'user_info',
        title: '达人信息',
        updateTime: new Date().toLocaleString('zh-CN'),
        user: {
          nickname: u.nickname || '',
          uniqueId: u.unique_id || uniqueId,
          uid: u.uid || '',
          signature: u.signature || '',
          avatarUrl: u.avatar_thumb?.url_list?.[0] || u.avatar_url || '',
          followerCount: u.follower_count || u.fans_count || 0,
          followingCount: u.following_count || 0,
          awemeCount: u.aweme_count || u.video_count || 0,
          totalFavorited: u.total_favorited || u.like_count || 0,
          verified: u.custom_verify || u.enterprise_verify_reason || '',
          region: u.region || u.country || '',
        },
      });
    }

    // ══════════════════════════════════════════════════════
    // 诊断接口：直接返回 TikHub 原始响应，用于排查
    // ══════════════════════════════════════════════════════
    else if (endpoint === 'debug') {
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const testUrls = [
        `${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`,
        `${BASE}/api/v1/douyin/app/v2/fetch_hot_search_list`,
        `${BASE}/api/v1/douyin/web/fetch_hot_search_list`,
      ];
      const results = {};
      for (const url of testUrls) {
        try {
          const res = await fetch(url, { headers });
          const text = await res.text();
          results[url.replace(BASE, '')] = { status: res.status, body: text.slice(0, 600) };
        } catch (e) {
          results[url.replace(BASE, '')] = { error: e.message };
        }
      }
      return ok({ type: 'debug', results });
    }

    else {
      return err(`未知 endpoint: ${endpoint}。可用: hot_search, search, user_info, debug`);
    }

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '服务器错误', detail: e.message }), { status: 500, headers: CORS });
  }
}
