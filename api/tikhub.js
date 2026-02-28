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

// 从响应中提取热搜列表（穷举所有可能位置）
function extractHotList(json) {
  const d = json?.data;
  if (!d) return [];
  // data.data 可能是数组或对象
  if (Array.isArray(d.data)) return d.data;
  if (d.data && typeof d.data === 'object') {
    // 在子对象里找数组
    for (const k of Object.keys(d.data)) {
      if (Array.isArray(d.data[k]) && d.data[k].length > 0) return d.data[k];
    }
  }
  if (Array.isArray(d.word_list)) return d.word_list;
  if (Array.isArray(d.sentence_list)) return d.sentence_list;
  if (Array.isArray(d.hot_list)) return d.hot_list;
  if (Array.isArray(d.list)) return d.list;
  if (Array.isArray(d)) return d;
  return [];
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint') || 'hot_search';
  const keyword  = searchParams.get('keyword') || '';
  const uniqueId = searchParams.get('unique_id') || '';

  const token = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return err('Missing TikHub API Key');

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {

    // ════════════════════════════════════════
    // 热搜榜
    // ════════════════════════════════════════
    if (endpoint === 'hot_search') {
      const res = await fetch(`${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`, { headers: authHeaders });
      const json = await res.json();

      if (json?.code !== 200) {
        return err('TikHub API error: ' + (json?.message_zh || json?.message || json?.code), 502);
      }

      const list = extractHotList(json);

      if (!list || list.length === 0) {
        return ok({
          type: 'hot_search', title: '抖音热搜榜',
          updateTime: new Date().toLocaleString('zh-CN'), items: [],
          _debug: {
            dataType: typeof json?.data?.data,
            isArray: Array.isArray(json?.data?.data),
            dataKeys: Object.keys(json?.data || {}),
            dataDotDataKeys: json?.data?.data && typeof json.data.data === 'object' ? Object.keys(json.data.data) : [],
            sample: JSON.stringify(json?.data).slice(0, 500),
          }
        });
      }

      return ok({
        type: 'hot_search', title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: list.map((item, idx) => ({
          rank: idx + 1,
          word: item.word || item.sentence || item.hot_value_desc || item.title || item.name || item.query || '',
          hotValue: item.hot_value || item.event_count || item.hot_score || item.score || 0,
          label: item.label_name || item.sentence_label || item.label || item.tag || '',
          coverUrl: item.cover_url || item.cover?.url_list?.[0] || '',
        })),
      });
    }

    // ════════════════════════════════════════
    // 关键词搜索视频 - 多接口 fallback
    // ════════════════════════════════════════
    else if (endpoint === 'search') {
      if (!keyword) return err('请提供 keyword 参数');

      const kw = encodeURIComponent(keyword);
      const searchUrls = [
        `${BASE}/api/v1/douyin/app/v3/fetch_search_result?keyword=${kw}&count=20`,
        `${BASE}/api/v1/douyin/app/v3/fetch_video_search_result?keyword=${kw}&count=20`,
        `${BASE}/api/v1/douyin/app/v2/fetch_search_result?keyword=${kw}&count=20`,
        `${BASE}/api/v1/douyin/web/fetch_video_search_result?keyword=${kw}&count=20&offset=0`,
      ];

      let json = null;
      for (const url of searchUrls) {
        try {
          const r = await fetch(url, { headers: authHeaders });
          const j = await r.json();
          if (j?.code === 200) { json = j; break; }
        } catch(e) { continue; }
      }

      if (!json) return ok({ type: 'search', keyword, title: `"${keyword}" 搜索结果`, updateTime: new Date().toLocaleString('zh-CN'), items: [] });

      const rawList = json?.data?.aweme_list || json?.data?.data;
      const list = Array.isArray(rawList) ? rawList : [];

      if (list.length === 0) {
        return ok({ type: 'search', keyword, title: `"${keyword}" 搜索结果`, updateTime: new Date().toLocaleString('zh-CN'), items: [] });
      }

      return ok({
        type: 'search', keyword,
        title: `"${keyword}" 搜索结果`,
        updateTime: new Date().toLocaleString('zh-CN'),
        items: list.map(item => {
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

    // ════════════════════════════════════════
    // 达人信息
    // ════════════════════════════════════════
    else if (endpoint === 'user_info') {
      if (!uniqueId) return err('请提供 unique_id 参数（抖音号）');
      const uid = encodeURIComponent(uniqueId);
      const res = await fetch(`${BASE}/api/v1/douyin/app/v3/fetch_user_info?unique_id=${uid}`, { headers: authHeaders });
      const json = await res.json();
      const u = json?.data?.user || json?.data || {};
      if (!u.nickname && !u.uid) return err('未找到该用户');
      return ok({
        type: 'user_info', title: '达人信息',
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

    // ════════════════════════════════════════
    // 诊断接口
    // ════════════════════════════════════════
    else if (endpoint === 'debug') {
      const res = await fetch(`${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`, { headers: authHeaders });
      const json = await res.json();
      const extracted = extractHotList(json);
      return ok({
        type: 'debug', httpStatus: res.status,
        tikhubCode: json?.code,
        dataKeys: Object.keys(json?.data || {}),
        dataDataType: typeof json?.data?.data,
        dataDataIsArray: Array.isArray(json?.data?.data),
        dataDataKeys: (json?.data?.data && typeof json.data.data === 'object' && !Array.isArray(json.data.data)) ? Object.keys(json.data.data) : [],
        extractedCount: extracted.length,
        firstItem: extracted[0] ? JSON.stringify(extracted[0]).slice(0, 300) : 'empty',
      });
    }

    else {
      return err(`未知 endpoint: ${endpoint}`);
    }

  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: '服务器错误', detail: e.message }),
      { status: 500, headers: CORS }
    );
  }
}
