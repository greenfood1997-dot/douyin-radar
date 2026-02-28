export const config = { runtime: 'edge' };

const TIKHUB_BASE = 'https://api.tikhub.io';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key,anthropic-version',
  'Content-Type': 'application/json',
};

export default async function handler(req) {
  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint') || 'hot_search';
  const keyword  = searchParams.get('keyword') || '';
  const uniqueId = searchParams.get('unique_id') || '';

  // 从请求头获取 TikHub API Key
  const token =
    req.headers.get('x-api-key') ||
    req.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Missing TikHub API Key' }),
      { status: 400, headers: CORS }
    );
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    let data;

    // ── 1. 抖音热搜榜 ──────────────────────────────────────────
    if (endpoint === 'hot_search') {
      const res = await fetch(
        `${TIKHUB_BASE}/api/v1/douyin/web/fetch_hot_search_list`,
        { headers: authHeaders }
      );
      const json = await res.json();

      const items = json?.data?.word_list || json?.data?.sentence_list || [];
      data = {
        type: 'hot_search',
        title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: items.map((item, idx) => ({
          rank: idx + 1,
          word: item.word || item.sentence || item.hot_value_desc || '',
          hotValue: item.hot_value || item.event_count || 0,
          label: item.label_name || item.sentence_label || '',
          coverUrl: item.cover_url || '',
        })),
      };
    }

    // ── 2. 抖音直播热搜榜 ──────────────────────────────────────
    else if (endpoint === 'live_hot_search') {
      const res = await fetch(
        `${TIKHUB_BASE}/api/v1/douyin/web/fetch_live_hot_search_list`,
        { headers: authHeaders }
      );
      const json = await res.json();

      const items = json?.data?.word_list || json?.data?.sentence_list || [];
      data = {
        type: 'live_hot_search',
        title: '抖音直播热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: items.map((item, idx) => ({
          rank: idx + 1,
          word: item.word || item.sentence || '',
          hotValue: item.hot_value || item.event_count || 0,
          label: item.label_name || '',
          coverUrl: item.cover_url || '',
        })),
      };
    }

    // ── 3. 关键词搜索视频 ──────────────────────────────────────
    else if (endpoint === 'search') {
      if (!keyword) {
        return new Response(
          JSON.stringify({ error: '请提供 keyword 参数' }),
          { status: 400, headers: CORS }
        );
      }
      const res = await fetch(
        `${TIKHUB_BASE}/api/v1/douyin/web/fetch_video_search_result?keyword=${encodeURIComponent(keyword)}&count=20&offset=0&sort_type=0&publish_time=0`,
        { headers: authHeaders }
      );
      const json = await res.json();

      const list = json?.data?.data || [];
      data = {
        type: 'search',
        keyword,
        title: `"${keyword}" 搜索结果`,
        updateTime: new Date().toLocaleString('zh-CN'),
        items: list.map((item) => {
          const v = item.aweme_info || item;
          return {
            awemeId: v.aweme_id || '',
            desc: v.desc || '',
            author: v.author?.nickname || '',
            authorId: v.author?.unique_id || v.author?.uid || '',
            coverUrl: v.video?.cover?.url_list?.[0] || '',
            playCount: v.statistics?.play_count || 0,
            diggCount: v.statistics?.digg_count || 0,
            commentCount: v.statistics?.comment_count || 0,
            shareCount: v.statistics?.share_count || 0,
            createTime: v.create_time
              ? new Date(v.create_time * 1000).toLocaleDateString('zh-CN')
              : '',
          };
        }),
      };
    }

    // ── 4. 达人/博主信息 ───────────────────────────────────────
    else if (endpoint === 'user_info') {
      if (!uniqueId) {
        return new Response(
          JSON.stringify({ error: '请提供 unique_id 参数（抖音号）' }),
          { status: 400, headers: CORS }
        );
      }
      const res = await fetch(
        `${TIKHUB_BASE}/api/v1/douyin/web/fetch_user_info?unique_id=${encodeURIComponent(uniqueId)}`,
        { headers: authHeaders }
      );
      const json = await res.json();

      const u = json?.data?.user || json?.data || {};
      data = {
        type: 'user_info',
        title: '达人信息',
        updateTime: new Date().toLocaleString('zh-CN'),
        user: {
          nickname: u.nickname || '',
          uniqueId: u.unique_id || uniqueId,
          uid: u.uid || '',
          signature: u.signature || '',
          avatarUrl: u.avatar_thumb?.url_list?.[0] || '',
          followerCount: u.follower_count || 0,
          followingCount: u.following_count || 0,
          awemeCount: u.aweme_count || 0,
          totalFavorited: u.total_favorited || 0,
          verified: u.custom_verify || u.enterprise_verify_reason || '',
          region: u.region || '',
        },
      };
    }

    // ── 5. 抖音音乐热榜 ────────────────────────────────────────
    else if (endpoint === 'music_hot') {
      const res = await fetch(
        `${TIKHUB_BASE}/api/v1/douyin/web/fetch_music_hot_search_list`,
        { headers: authHeaders }
      );
      const json = await res.json();

      const items = json?.data?.music_list || json?.data || [];
      data = {
        type: 'music_hot',
        title: '抖音音乐热榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: (Array.isArray(items) ? items : []).map((item, idx) => ({
          rank: idx + 1,
          title: item.title || item.music_name || '',
          author: item.author || item.artist || '',
          coverUrl: item.cover_url || item.cover_medium?.url_list?.[0] || '',
          playCount: item.play_count || item.use_count || 0,
        })),
      };
    }

    // ── 未知 endpoint ──────────────────────────────────────────
    else {
      return new Response(
        JSON.stringify({
          error: `未知 endpoint: ${endpoint}`,
          available: ['hot_search', 'live_hot_search', 'search', 'user_info', 'music_hot'],
        }),
        { status: 400, headers: CORS }
      );
    }

    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200,
      headers: CORS,
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: '服务器内部错误', detail: err.message }),
      { status: 500, headers: CORS }
    );
  }
}
