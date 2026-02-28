export const config = { runtime: 'edge' };

const BASE = 'https://api.tikhub.dev';

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

// 从 App V3 热搜响应中提取列表
function extractHotList(json) {
  const d = json?.data;
  if (!d) return [];
  if (Array.isArray(d.data)) return d.data;
  if (d.data && typeof d.data === 'object') {
    for (const k of Object.keys(d.data)) {
      if (Array.isArray(d.data[k]) && d.data[k].length > 0) return d.data[k];
    }
  }
  if (Array.isArray(d.word_list)) return d.word_list;
  if (Array.isArray(d.sentence_list)) return d.sentence_list;
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
          _debug: { dataKeys: Object.keys(json?.data || {}), sample: JSON.stringify(json?.data).slice(0, 300) }
        });
      }

      return ok({
        type: 'hot_search', title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: list.map((item, idx) => ({
          rank: idx + 1,
          word: item.word || item.sentence || item.hot_value_desc || item.title || item.name || '',
          hotValue: item.hot_value || item.event_count || item.hot_score || item.score || 0,
          label: item.label_name || item.sentence_label || item.label || item.tag || '',
          coverUrl: item.cover_url || item.cover?.url_list?.[0] || '',
        })),
      });
    }

    // ════════════════════════════════════════
    // 关键词搜索视频 - 使用 Web Search API
    // 按文档推荐，失败自动重试3次
    // ════════════════════════════════════════
    else if (endpoint === 'search') {
      if (!keyword) return err('请提供 keyword 参数');

      const kw = encodeURIComponent(keyword);

      // 按 TikHub 文档推荐的接口顺序（Web Search API 最稳定）
      const endpoints_to_try = [
        // Web综合搜索（文档推荐最稳定）
        `${BASE}/api/v1/douyin/web/fetch_general_search_result?keyword=${kw}&count=20&offset=0&search_channel=aweme_general&search_source=normal_search`,
        // Web视频搜索（带重试机制）
        `${BASE}/api/v1/douyin/web/fetch_video_search_result?keyword=${kw}&count=20&offset=0&sort_type=0&publish_time=0`,
        // App V3 搜索
        `${BASE}/api/v1/douyin/app/v3/fetch_search_result?keyword=${kw}&count=20`,
      ];

      let bestResult = null;

      for (const url of endpoints_to_try) {
        // 每个接口最多重试2次（文档说失败率<5%，重试可解决）
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await fetch(url, { headers: authHeaders });
            const j = await r.json();

            if (j?.code !== 200) break; // 这个接口不可用，换下一个

            // 提取视频列表
            const rawList = j?.data?.aweme_list
              || j?.data?.data
              || j?.data?.business_data?.flatMap?.(b => b.aweme_info ? [b.aweme_info] : [])
              || [];

            const list = Array.isArray(rawList) ? rawList.filter(Boolean) : [];

            if (list.length > 0) {
              bestResult = { list, url };
              break;
            }
          } catch(e) { continue; }
        }
        if (bestResult) break;
      }

      if (!bestResult || bestResult.list.length === 0) {
        return ok({
          type: 'search', keyword,
          title: `"${keyword}" 搜索结果`,
          updateTime: new Date().toLocaleString('zh-CN'),
          items: [],
          _debug: 'all search endpoints returned empty after retries'
        });
      }

      return ok({
        type: 'search', keyword,
        title: `"${keyword}" 搜索结果`,
        updateTime: new Date().toLocaleString('zh-CN'),
        items: bestResult.list.map(item => {
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
      if (!uniqueId) return err('请提供 unique_id 参数');
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
    // 诊断接口 - 测试搜索接口
    // ════════════════════════════════════════
    else if (endpoint === 'debug') {
      const kw = encodeURIComponent('美食');
      // 测试新的 Douyin-Search-API 路径
      const urls = [
        `${BASE}/api/v1/douyin/search/fetch_video_search_v1?keyword=${kw}&count=10&offset=0`,
        `${BASE}/api/v1/douyin/search/fetch_video_search_v2?keyword=${kw}&count=10&offset=0`,
        `${BASE}/api/v1/douyin/search/fetch_general_search_v1?keyword=${kw}&count=10&offset=0`,
        `${BASE}/api/v1/douyin/search/fetch_general_search_v2?keyword=${kw}&count=10&offset=0`,
        `${BASE}/api/v1/douyin/web/fetch_video_search_result?keyword=${kw}&count=10&offset=0`,
      ];
      const results = {};
      for (const url of urls) {
        try {
          const r = await fetch(url, { headers: authHeaders });
          const text = await r.text();
          const path = url.replace(BASE, '').split('?')[0];
          let j = {};
          try { j = JSON.parse(text); } catch(e) {}
          const allKeys = Object.keys(j?.data || {});
          // 找所有可能的列表字段
          const listFields = {};
          for (const k of allKeys) {
            if (Array.isArray(j.data[k])) listFields[k] = j.data[k].length;
          }
          results[path] = {
            httpStatus: r.status,
            code: j?.code,
            message: j?.message_zh || j?.message || '',
            dataKeys: allKeys,
            listFields,
            rawSlice: text.slice(0, 200),
          };
        } catch(e) {
          results[url.replace(BASE, '').split('?')[0]] = { error: e.message };
        }
      }
      return ok({ type: 'debug', results });
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
