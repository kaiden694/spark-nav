import { z } from "astro/zod";

export const hexColorSchema = z.string().regex(
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  { message: "颜色代码必须为合法的 Hex 格式 (如 #ff5e52, #fff)" }
);

export const themePresetColorSchema = z.object({
  name: z.string().min(1, "预设配色名称不能为空"),
  color: hexColorSchema,
});

export const themeConfigSchema = z.object({
  primaryColor: hexColorSchema,
  presetColors: z.array(themePresetColorSchema).min(1, "至少需要提供一种预设主题配色"),
  enableColorSwitcher: z.boolean().default(true),
  enableDarkMode: z.boolean().default(true),
});

export const slideItemSchema = z.object({
  title: z.string().min(1, "轮播图标题不能为空"),
  img: z.string().min(1, "轮播图图片地址不能为空"),
  url: z.string().optional().default("/"),
});

export const focusItemSchema = z.object({
  title: z.string().min(1, "焦点图标题不能为空"),
  img: z.string().min(1, "焦点图图片地址不能为空"),
  url: z.string().optional().default("/"),
  isLarge: z.boolean().optional(),
  placeholder: z.string().optional(),
});

export const friendLinkSchema = z.object({
  name: z.string().min(1, "友情链接名称不能为空"),
  url: z.string().min(1, "友情链接 URL 不能为空"),
});

export const contactConfigSchema = z.object({
  qq: z.string().min(1, "QQ 号不能为空"),
  wechat: z.string().min(1, "微信号不能为空"),
  wechatQr: z.string().min(1, "微信二维码路径不能为空"),
  onlineConsultUrl: z.string().min(1, "在线咨询链接不能为空"),
});

export const siteHeaderSubLinkSchema = z.object({
  title: z.string().min(1, "导航子链接标题不能为空"),
  url: z.string().min(1, "导航子链接 URL 不能为空"),
});

export const siteHeaderConfigSchema = z.object({
  feedQr: z.string().min(1, "关注二维码不能为空"),
  feedText: z.string().min(1, "关注引导文案不能为空"),
  subLinks: z.array(siteHeaderSubLinkSchema).default([]),
});

export const rewardsConfigSchema = z.object({
  title: z.string().default("觉得文章有用就打赏一下文章作者"),
  alipayQr: z.string().default("/assets/images/brand/reward-alipay.png"),
  wechatQr: z.string().default("/assets/images/brand/reward-wechat.png"),
});

export const siteConfigSchema = z.object({
  name: z.string().min(1, "站点名称不能为空"),
  subTitle: z.string().default(""),
  description: z.string().default(""),
  keywords: z.string().default(""),
  url: z.string().default("/"),
  author: z.string().default("XIU 编辑部"),
  authorBio: z.string().default("关注数字科技、现代生活与创作者文化的独立记录者。"),
  authorAvatar: z.string().default("/assets/images/avatars/cartoon-admin.png"),
  copyrightYear: z.number().int().min(2000, "版权年份必须为合法年份 (>= 2000)"),
  logo: z.string().default("/assets/images/brand/logo.png"),
  footerText: z.string().default("纯静态响应式独立主题"),
  enableLanguageSwitcher: z.boolean().default(false),
  postsPerPage: z.number().int().min(1, "每页文章数必须大于 0").default(10),
  theme: themeConfigSchema,
  contact: contactConfigSchema,
  header: siteHeaderConfigSchema,
  rewards: rewardsConfigSchema.default({}),
  bannerSlides: z.array(slideItemSchema).default([]),
  focusItems: z.array(focusItemSchema).default([]),
  friendLinks: z.array(friendLinkSchema).default([]),
});

export type ThemePresetColor = z.infer<typeof themePresetColorSchema>;
export type ThemeConfig = z.infer<typeof themeConfigSchema>;
export type SlideItem = z.infer<typeof slideItemSchema>;
export type FocusItem = z.infer<typeof focusItemSchema>;
export type FriendLink = z.infer<typeof friendLinkSchema>;
export type ContactConfig = z.infer<typeof contactConfigSchema>;
export type SiteHeaderSubLink = z.infer<typeof siteHeaderSubLinkSchema>;
export type SiteHeaderConfig = z.infer<typeof siteHeaderConfigSchema>;
export type RewardsConfig = z.infer<typeof rewardsConfigSchema>;
export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type SiteConfigInput = z.input<typeof siteConfigSchema>;
export type SiteConfigOutput = z.infer<typeof siteConfigSchema>;

export function validateSiteConfig(raw: unknown) {
  return siteConfigSchema.safeParse(raw);
}
