export const config = { runtime: 'edge' };

const BASE = 'https://api.tikhub.io';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key,anthropic-version',
  'Content-Type': 'application/json',
};

函数 ok(data) {
  return new Response(JSON.stringify({ success: true, ...data }), { status: 200, headers: CORS });
}
函数 err(msg, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), { status, headers: CORS });
}

// 尝试多个URL，返回第一个成功且有数据的结果
异步函数 tryUrls(urls, token, pick) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (const url of urls) {
    尝试 {
      const res = await fetch(url, { headers });
      如果 (!res.ok) 继续；
      const json = await res.json();
      const items = pick(json);
      如果 (items 存在且 items 的长度大于 0) 返回 { items, _raw: json };
    } catch (e) {
      继续;
    }
  }
  返回空值；
}

export default async function handler(req) {
  如果 (请求方法 === 'OPTIONS') 返回新的响应(null, { status: 204, headers: CORS });

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get('endpoint') || 'hot_search';
  const keyword = searchParams.get('keyword') || '';
  const uniqueId = searchParams.get('unique_id') || '';

  const token = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return err('缺少 TikHub API 密钥');

  尝试 {

    // ══════════════════════════════════════════════════════
    // 热搜榜：多接口回退（优先App V3）
    // ══════════════════════════════════════════════════════
    如果 (endpoint === 'hot_search') {
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
      ）；

      如果 (!result) 返回 ok({
        type: 'hot_search', title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'), items: [],
        _debug：'所有端点均返回空值'
      });

      返回 ok({
        类型：'热门搜索'
        title: '抖音热搜榜',
        updateTime: new Date().toLocaleString('zh-CN'),
        items: result.items.map((item, idx) => ({
          排名：idx + 1，
          词：item.word || item.sentence || item.hot_value_desc || item.title || item.name || '',
          hotValue: item.hot_value || item.event_count || item.hot_score || 0,
          标签：item.label_name || item.sentence_label || item.label || '',
          coverUrl: item.cover_url || item.cover?.url_list?.[0] || '',
        })),
      });
    }

    // ══════════════════════════════════════════════════════
    // 关键词搜索视频：多接口回退
    // ══════════════════════════════════════════════════════
    否则如果（端点 === 'search'）{
      if (!keyword) return err('请提供关键字参数');

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
      ）；

      if (!result) return ok({ type: 'search', keyword, title: `"${keyword}" 搜索结果`, updateTime: new Date().toLocaleString('zh-CN'), items: [] });

      返回 ok({
        类型：'搜索'，
        关键词，
        title: `"${keyword}" 搜索结果`,
        updateTime: new Date().toLocaleString('zh-CN'),
        items: result.items.map(item => {
          const v = item.aweme_info || item;
          const stat = v.statistics || v.stats || {};
          返回 {
            awemeId: v.aweme_id || v.id || '',
            desc: v.desc || v.title || '',
            作者：v.author?.nickname || v.author?.name || '',
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
    否则如果（端点 === 'user_info'）{
      if (!uniqueId) return err('请提供 unique_id 参数（抖音号）');

      const uid = encodeURIComponent(uniqueId);
      const result = await tryUrls([
        `${BASE}/api/v1/douyin/app/v3/fetch_user_info?unique_id=${uid}`,
        `${BASE}/api/v1/douyin/web/fetch_user_info?unique_id=${uid}`,
        `${BASE}/api/v1/douyin/app/v2/fetch_user_info?unique_id=${uid}`,
      ], token, (json) => {
        const u = json?.data?.user || json?.data;
        返回 u?.uid || u?.nickname ? [u] : null;
      });

      if (!result) return err('未找到该用户');
      const u = result.items[0];
      返回 ok({
        类型：'user_info'，
        title: '达人信息',
        updateTime: new Date().toLocaleString('zh-CN'),
        用户：{
          昵称：u.nickname || '',
          uniqueId: u.unique_id || uniqueId,
          uid: u.uid || '',
          签名：u.signature || '',
          avatarUrl: u.avatar_thumb?.url_list?.[0] || u.avatar_url || '',
          followerCount: u.follower_count || u.fans_count || 0,
          followingCount: u.following_count || 0,
          awemeCount：u.aweme_count || u.video_count || 0，
          totalFavorited: u.total_favorited || u.like_count || 0,
          已验证：u.custom_verify || u.enterprise_verify_reason || '',
          区域：u.region || u.country || '',
        },
      });
    }

    // ══════════════════════════════════════════════════════
    // 诊断接口：直接返回 TikHub 原始响应，用于排查
    // ══════════════════════════════════════════════════════
    否则如果（端点 === 'debug'）{
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const testUrls = [
        `${BASE}/api/v1/douyin/app/v3/fetch_hot_search_list`,
        `${BASE}/api/v1/douyin/app/v2/fetch_hot_search_list`,
        `${BASE}/api/v1/douyin/web/fetch_hot_search_list`,
      ];
      const results = {};
      for (const url of testUrls) {
        尝试 {
          const res = await fetch(url, { headers });
          const text = await res.text();
          results[url.replace(BASE, '')] = { status: res.status, body: text.slice(0, 600) };
        } catch (e) {
          results[url.replace(BASE, '')] = { error: e.message };
        }
      }
      返回 ok({ type: 'debug', results });
    }

    别的 {
      return err(`未知端点: ${endpoint}。可用: hot_search, search, user_info, debug`);
    }

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '服务器错误',detail: e.message }), { status: 500, headers: CORS });
  }
}
