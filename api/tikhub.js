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

// 从 V3 响应中提取列表（穷举所有可能字段）
function extractList(json) {
  if (!json) return null;
  const d = json.data || json;
  // 热搜相关字段
  const list =
    d.word_list || d.sentence_list || d.hot_list || d.hotList ||
    d.data || d.list || d.items || d.result || d.trending ||
    d.hot_search_list || d.hotSearchList ||
    (Array.isArray(d) ? d : null);
  return list && list.length > 0 ? list : null;
}

// 从单条热搜条目提取词语
function extractWord(item) {
  return item.word || item.sentence || item.hot_value_desc ||
         item.title || item.name || item.query || item.text ||
         item.keyword || item.content || JSON.stringify(item).slice(0, 40);
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

    // ════════════════════════════════════════════════
    // 热搜榜
    // ════════════════════════════════════════════════
    if (endpoint === 'hot_search') {
      const res = await fetch(`${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`, { headers: authHeaders });
      const json = await res.json();

      // 把完整 data 结构暴露出来方便调试
      const rawData = json?.data || json;
      const list = extractList(json);

      if (!list) {
        // 返回原始结构供前端调试
        return ok({
          type: 'hot_search',
          title: '抖音热搜榜',
          updateTime: new Date().toLocaleString('zh-CN'),
          items: [],
          _rawKeys: Object.keys(rawData || {}),
          _rawSample: JSON.stringify(rawData).slice(0, 800),
        });
      }

      return ok({
        type: 'hot_search',
        title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: list.map((item, idx) => ({
          rank: idx + 1,
          word: extractWord(item),
          hotValue: item.hot_value || item.event_count || item.hot_score || item.score || item.view_count || 0,
          label: item.label_name || item.sentence_label || item.label || item.tag || '',
          coverUrl: item.cover_url || item.cover?.url_list?.[0] || item.image || '',
        })),
      });
    }

    // ════════════════════════════════════════════════
    // 关键词搜索视频
    // ════════════════════════════════════════════════
    else if (endpoint === 'search') {
      if (!keyword) return err('请提供 keyword 参数');

      const kw = encodeURIComponent(keyword);
      const res = await fetch(
        `${BASE}/api/v1/douyin/app/v3/fetch_search_result?keyword=${kw}&count=20&offset=0&search_id=&sort_type=0&publish_time=0&filter_duration=0`,
        { headers: authHeaders }
      );
      const json = await res.json();
      const rawData = json?.data || json;
      const list = extractList(json);

      if (!list) {
        return ok({
          type: 'search', keyword,
          title: `"${keyword}" 搜索结果`,
          updateTime: new Date().toLocaleString('zh-CN'),
          items: [],
          _rawKeys: Object.keys(rawData || {}),
          _rawSample: JSON.stringify(rawData).slice(0, 800),
        });
      }

      return ok({
        type: 'search',
        keyword,
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

    // ════════════════════════════════════════════════
    // 达人信息
    // ════════════════════════════════════════════════
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

    // ════════════════════════════════════════════════
    // 诊断接口：返回完整原始数据
    // ════════════════════════════════════════════════
    else if (endpoint === 'debug') {
      const res = await fetch(`${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`, { headers: authHeaders });
      const json = await res.json();
      return ok({
        type: 'debug',
        status: res.status,
        topLevelKeys: Object.keys(json || {}),
        dataKeys: Object.keys(json?.data || {}),
        fullResponse: JSON.stringify(json).slice(0, 2000),
      });
    }

    else {
      return err(`未知 endpoint: ${endpoint}。可用: hot_search, search, user_info, debug`);
    }

  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: '服务器错误', detail: e.message }),
      { status: 500, headers: CORS }
    );
  }
}
