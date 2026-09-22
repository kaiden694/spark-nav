import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  expandIntentTags,
  SUBCAT_CORE_INTENTS,
  SEMANTIC_INTENT_RULES
} from '../enrich-intent-tags.mjs';

test('expandIntentTags extracts video & streaming intent tags for media resources', () => {
  const tags = expandIntentTags({
    title: '影视追剧大全',
    description: '聚合全网高清电影、热播电视剧与动漫无损在线观看。',
    subcategory: 'media',
    existingTags: ['影音资源']
  });

  assert.ok(tags.length >= 3 && tags.length <= 5, 'Tags count must be between 3 and 5');
  assert.ok(tags.includes('免费看剧') || tags.includes('影视资源') || tags.includes('在线播放'));
  assert.equal(new Set(tags).size, tags.length, 'Tags must not contain duplicates');
});

test('expandIntentTags extracts proxy & network intent tags for network tools', () => {
  const tags = expandIntentTags({
    title: 'Clash 高速节点订阅',
    description: '全球优质翻墙与科学上网代理客户端配置，稳定低延迟节点。',
    subcategory: 'network',
    existingTags: ['节点网络']
  });

  assert.ok(tags.includes('科学上网'));
  assert.ok(tags.includes('节点订阅') || tags.includes('代理客户端'));
  assert.ok(tags.length >= 3 && tags.length <= 5);
});

test('expandIntentTags extracts mod & ad-blocking intent tags for software tools', () => {
  const tags = expandIntentTags({
    title: '纯净安卓软件库',
    description: '精选免Root安卓去广告与破解应用，享受无弹窗极客体验。',
    subcategory: 'tools',
    existingTags: ['实用软件']
  });

  assert.ok(tags.includes('去广告') || tags.includes('安卓破解') || tags.includes('纯净版'));
  assert.ok(tags.length >= 3 && tags.length <= 5);
});

test('expandIntentTags extracts pan search & magnet intent tags for drive resources', () => {
  const tags = expandIntentTags({
    title: '夸克盘搜助手',
    description: '网盘搜索与磁力链接BT种子检索工具，快速找资源。',
    subcategory: 'tools',
    existingTags: ['极客工具']
  });

  assert.ok(tags.includes('网盘搜索') || tags.includes('磁力下载') || tags.includes('资源检索'));
  assert.ok(tags.length >= 3 && tags.length <= 5);
});

test('expandIntentTags gracefully falls back on minimal or empty input', () => {
  const tags = expandIntentTags({
    title: '',
    description: '',
    subcategory: 'community',
    existingTags: []
  });

  assert.ok(tags.length >= 3 && tags.length <= 5);
  assert.ok(tags.includes('社群交流') || tags.includes('同好圈子'));
});
