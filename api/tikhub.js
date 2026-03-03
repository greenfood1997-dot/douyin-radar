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
function err(msg, status = 400, detail = null) {
  return new Response(JSON.stringify({ success: false, error: msg, detail }), { status, headers: CORS });
}

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
  return [];
}

// 带超时的 fetch，默认 12 秒
async function fetchWithTimeout(url, options, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
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
    // 抖音热搜榜
    // ════════════════════════════════════════
    if (endpoint === 'hot_search') {
      const res = await fetchWithTimeout(`${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`, { headers: authHeaders });
      const json = await res.json();

      if (json?.code !== 200) {
        return err(json?.message_zh || json?.message || 'TikHub API 返回错误', 502,
          { tikhub_code: json?.code, raw: JSON.stringify(json).slice(0, 300) });
      }

      const list = extractHotList(json);
      if (!list || list.length === 0) {
        return ok({ type: 'hot_search', title: '抖音热搜榜',
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
    // 关键词搜索视频 —— 并行请求，取最快有数据的
    // ════════════════════════════════════════
    else if (endpoint === 'search') {
      if (!keyword) return err('请提供 keyword 参数');

      const kw = encodeURIComponent(keyword);

      // 并行同时请求，POST 方式
      const tryFetch = async (url, label, body) => {
        try {
          const r = await fetchWithTimeout(url, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(body),
          }, 15000);
          const j = await r.json();
          if (j?.code !== 200) return { label, code: j?.code, msg: j?.message_zh || j?.message, list: [] };

          const raw = j?.data?.aweme_list
            || j?.data?.data
            || j?.data?.business_data?.flatMap?.(b => b.aweme_info ? [b.aweme_info] : [])
            || [];
          const list = Array.isArray(raw) ? raw.filter(Boolean) : [];
          return { label, code: 200, list };
        } catch(e) {
          return { label, error: e.name === 'AbortError' ? 'timeout' : e.message, list: [] };
        }
      };

      const count = parseInt(searchParams.get('count')) || 20;
      const searchBody = { keyword, count };
      const [r1, r2, r3, r4] = await Promise.all([
        tryFetch(`${BASE}/api/v1/douyin/search/fetch_video_search_v1`, 'search_v1', searchBody),
        tryFetch(`${BASE}/api/v1/douyin/search/fetch_video_search_v2`, 'search_v2', searchBody),
        tryFetch(`${BASE}/api/v1/douyin/search/fetch_general_search_v1`, 'general_v1', searchBody),
        tryFetch(`${BASE}/api/v1/douyin/search/fetch_general_search_v2`, 'general_v2', searchBody),
      ]);

      const debugLog = [r1, r2, r3, r4].map(r => ({
        label: r.label, code: r.code, msg: r.msg, error: r.error, count: r.list.length
      }));

      // 取第一个有数据的结果
      const best = [r1, r2, r3, r4].find(r => r.list.length > 0);

      if (!best) {
        return ok({
          type: 'search', keyword, title: `"${keyword}" 搜索结果`,
          updateTime: new Date().toLocaleString('zh-CN'), items: [],
          _debug: debugLog
        });
      }

      return ok({
        type: 'search', keyword, title: `"${keyword}" 搜索结果`,
        updateTime: new Date().toLocaleString('zh-CN'),
        _source: best.label,
        items: best.list.map(item => {
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
    // 用户视频列表 —— 账号监测用
    // ════════════════════════════════════════
    else if (endpoint === 'user_posts') {
      const secUid = searchParams.get('sec_uid') || '';
      const uniqueId = searchParams.get('unique_id') || '';
      const count = parseInt(searchParams.get('count')) || 20;
      
      if (!secUid && !uniqueId) {
        return err('请提供 sec_uid 或 unique_id 参数');
      }

      // 如果已有 secUid，直接使用
      let targetSecUid = secUid;
      
      // 否则通过搜索该用户的视频来获取 sec_uid
      if (!targetSecUid && uniqueId) {
        try {
          // 搜索该 unique_id 的视频
          const searchRes = await fetchWithTimeout(
            `${BASE}/api/v1/douyin/search/fetch_video_search_v1`,
            { 
              method: 'POST', 
              headers: authHeaders, 
              body: JSON.stringify({ keyword: uniqueId, count: 5 }) 
            },
            15000
          );
          const searchJson = await searchRes.json();
          
          if (searchJson?.code === 200) {
            // 从搜索结果中提取该用户的 sec_uid
            // TikHub API 返回的数据在 data.data 中
            const awemeList = searchJson?.data?.aweme_list || searchJson?.data?.data || [];
            for (const item of awemeList) {
              const aweme = item.aweme_info || item;
              const authorUniqueId = aweme?.author?.unique_id || aweme?.author?.short_id || '';
              // 匹配 unique_id（不区分大小写）
              if (authorUniqueId.toLowerCase() === uniqueId.toLowerCase()) {
                targetSecUid = aweme?.author?.sec_uid || '';
                if (targetSecUid) break;
              }
            }
          }
        } catch(e) {
          console.warn('[user_posts] search for sec_uid failed:', e.message);
        }
      }
      
      if (!targetSecUid) {
        return err('无法获取用户 sec_uid，请检查 unique_id 是否正确或该用户是否有公开视频');
      }

      // 构建URL参数
      const url = `${BASE}/api/v1/douyin/app/v3/fetch_user_post_videos?sec_user_id=${encodeURIComponent(targetSecUid)}&count=${count}`;

      const res = await fetchWithTimeout(url, { headers: authHeaders }, 15000);
      const json = await res.json();

      if (json?.code !== 200) {
        return err(json?.message_zh || json?.message || 'TikHub API 返回错误', 502,
          { tikhub_code: json?.code, raw: JSON.stringify(json).slice(0, 300) });
      }

      const awemeList = json?.data?.aweme_list || json?.data?.videos || json?.data?.list || [];
      
      if (!awemeList || awemeList.length === 0) {
        return ok({ 
          type: 'user_posts', 
          title: '用户视频',
          updateTime: new Date().toLocaleString('zh-CN'), 
          items: [],
          _hint: '该用户暂无视频或需要更换查询方式'
        });
      }

      return ok({
        type: 'user_posts', 
        title: '用户视频',
        updateTime: new Date().toLocaleString('zh-CN'),
        total: awemeList.length,
        items: awemeList.map(v => {
          const stat = v.statistics || v.stats || {};
          return {
            aweme_id: v.aweme_id || v.id || '',
            desc: v.desc || v.title || '',
            create_time: v.create_time || 0,
            digg_count: stat.digg_count || stat.like_count || 0,
            comment_count: stat.comment_count || 0,
            share_count: stat.share_count || 0,
            play_count: stat.play_count || 0,
            cover_url: v.video?.cover?.url_list?.[0] || v.cover?.url_list?.[0] || '',
            author: {
              nickname: v.author?.nickname || '',
              unique_id: v.author?.unique_id || '',
              sec_uid: v.author?.sec_uid || '',
            }
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
      const res = await fetchWithTimeout(`${BASE}/api/v1/douyin/app/v3/fetch_user_info?unique_id=${uid}`, { headers: authHeaders });
      const json = await res.json();

      if (json?.code !== 200) {
        return err(json?.message_zh || json?.message || 'TikHub API 返回错误', 502,
          { tikhub_code: json?.code, raw: JSON.stringify(json).slice(0, 300) });
      }

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
      const kw = encodeURIComponent('美妆');
      const urls = [
        // 热搜（已知可用）
        { url: `${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`, label: 'hot_search' },
        // douyin/search/ 系列
        { url: `${BASE}/api/v1/douyin/search/fetch_video_search_v1`, label: 'search_v1', method: 'POST', body: { keyword: '美妆', count: 10 } },
        { url: `${BASE}/api/v1/douyin/search/fetch_video_search_v2`, label: 'search_v2', method: 'POST', body: { keyword: '美妆', count: 10 } },
        { url: `${BASE}/api/v1/douyin/search/fetch_general_search_v1`, label: 'general_v1', method: 'POST', body: { keyword: '美妆', count: 10 } },
        { url: `${BASE}/api/v1/douyin/search/fetch_general_search_v2`, label: 'general_v2', method: 'POST', body: { keyword: '美妆', count: 10 } },
        // douyin/billboard/ 系列 - 尝试更多接口名
        { url: `${BASE}/api/v1/douyin/billboard/fetch_douyin_hot_video_list`, label: 'billboard_v1' },
        { url: `${BASE}/api/v1/douyin/billboard/fetch_hot_search_list`, label: 'billboard_hot_search' },
        { url: `${BASE}/api/v1/douyin/billboard/fetch_rising_hot_list`, label: 'billboard_rising' },
      ];
      const results = await Promise.all(urls.map(async ({ url, label, method, body }) => {
        try {
          const fetchOpts = method === 'POST'
            ? { headers: { ...authHeaders }, method: 'POST', body: JSON.stringify(body) }
            : { headers: authHeaders };
          const r = await fetchWithTimeout(url, fetchOpts, 12000);
          const text = await r.text();
          let j = {};
          try { j = JSON.parse(text); } catch(e) {}
          const allKeys = Object.keys(j?.data || {});
          const listFields = {};
          for (const k of allKeys) {
            if (Array.isArray(j?.data?.[k])) listFields[k] = j.data[k].length;
          }
          return { label, httpStatus: r.status, code: j?.code, message: j?.message_zh || j?.message || '', dataKeys: allKeys, listFields, raw: text.slice(0, 200) };
        } catch(e) {
          return { label, error: e.name === 'AbortError' ? 'TIMEOUT' : e.message };
        }
      }));
      return ok({ type: 'debug', base: BASE, results });
    }

    else {
      return err(`未知 endpoint: ${endpoint}`);
    }

  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: '服务器错误', detail: e.message, stack: e.stack?.slice(0,300) }),
      { status: 500, headers: CORS }
    );
  }
}
