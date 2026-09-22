import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseMemberCount,
  cleanDescription,
  mapTgnavCategory,
  parseDetailPage
} from '../import-tgnav-sources.mjs';

test('parseMemberCount parses K, M and raw numeric counts', () => {
  assert.equal(parseMemberCount('10.7K'), 10700);
  assert.equal(parseMemberCount('2.5M'), 2500000);
  assert.equal(parseMemberCount('1,234'), 1234);
  assert.equal(parseMemberCount('500'), 500);
  assert.equal(parseMemberCount(''), 0);
  assert.equal(parseMemberCount(null), 0);
});

test('cleanDescription cleans HTML entities and boilerplate prefixes', () => {
  const boilerplate = 'Telegram 频道 @sample (Sample Title) 的详情介绍与直达加入链接。包含订阅成员数、更新时间及详细描述：这是一个关于技术分享的频道。';
  assert.equal(cleanDescription(boilerplate), '这是一个关于技术分享的频道。');

  const entities = 'Apple &amp; Google &lt;Tech&gt;';
  assert.equal(cleanDescription(entities), 'Apple & Google <Tech>');

  assert.equal(cleanDescription('（暂无描述）'), '');
  assert.equal(cleanDescription('（暂无描述）...'), '');
  assert.equal(cleanDescription('(暂无描述)...'), '');
});

test('mapTgnavCategory aligns TGNAV categories to navigation subcategories', () => {
  assert.equal(mapTgnavCategory('资讯新闻', 'channel').subcat, 'news');
  assert.equal(mapTgnavCategory('iOS资源', 'channel').subcat, 'tools');
  assert.equal(mapTgnavCategory('开发编程', 'channel').subcat, 'dev');
  assert.equal(mapTgnavCategory('机场测试', 'channel').subcat, 'network');
  assert.equal(mapTgnavCategory('影音资源', 'channel').subcat, 'media');
  assert.equal(mapTgnavCategory('金融理财', 'channel').subcat, 'finance');
  assert.equal(mapTgnavCategory('消息收发', 'bot').subcat, 'tools');

  // Software channels with "福利" must NOT be misclassified as NSFW
  const pjapkRes = mapTgnavCategory('综合', 'channel', '破解软件中文频道 🅥', '分享各类安卓去广告 |解锁 |绿化版 |软件 |游戏、老司机福利、XP模块');
  assert.equal(pjapkRes.isNsfw, false);
  assert.equal(pjapkRes.subcat, 'tools');

  // Disclaimer in tech groups must NOT trigger NSFW
  const techGroupRes = mapTgnavCategory('综合', 'group', '在花🎗️科技圈', '禁止推广/黑产/刷屏/色情/ NSFW');
  assert.equal(techGroupRes.isNsfw, false);
  assert.notEqual(techGroupRes.subcat, 'nsfw');

  // Genuine NSFW detection
  const nsfwRes = mapTgnavCategory('成人', 'channel', 'MissAV Daily', '每日精选AV');
  assert.equal(nsfwRes.isNsfw, true);
  assert.equal(nsfwRes.subcat, 'nsfw');
  assert.deepEqual(nsfwRes.tags, ['NSFW', '成人内容', '18+']);
});

test('parseDetailPage extracts fields from sample HTML structure', () => {
  const sampleHtml = `
    <html>
      <head>
        <title>Tech Hub - Telegram频道 | TGNAV</title>
        <meta name="description" content="Tech Hub Telegram 频道">
      </head>
      <body>
        <h1>Tech Hub</h1>
        <span class="type-badge">频道</span>
        <a class="category-badge">开发编程</a>
        <a href="/go/?username=techhub_cn&title=Tech%20Hub&type=channel">直达</a>
        <img data-src="https://avatar.tgnav.org/small/techhub_cn.jpg" />
        <span class="title-large">15.2K</span>
        <div class="body-large">最新的技术资讯与开源工具汇总。</div>
      </body>
    </html>
  `;

  const item = parseDetailPage(sampleHtml, 'techhub_cn');
  assert.equal(item.username, 'techhub_cn');
  assert.equal(item.title, 'Tech Hub');
  assert.equal(item.type, 'channel');
  assert.equal(item.subcategory, 'dev');
  assert.equal(item.member_count, 15200);
  assert.equal(item.avatar_url, 'https://avatar.tgnav.org/small/techhub_cn.jpg');
  assert.equal(item.description, '最新的技术资讯与开源工具汇总。');
  assert.equal(item.is_nsfw, false);
});
