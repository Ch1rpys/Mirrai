/**
 * The documentation site (C9.7).
 *
 * Built locally, never deployed: `corepack pnpm docs:build` writes a
 * static site into `docs/.vitepress/dist` (git-ignored). The pages are the
 * repository's own `docs/*.md` files — nothing is rewritten here, so a
 * document is the same file the code and the people read.
 *
 * Two things need a word, because both are worked around here rather than
 * by editing a document:
 *
 * 1. Several documents are written for a model reading them and contain
 *    literal `{{placeholder}}` text. VitePress compiles markdown as a Vue
 *    template, where `{{ }}` means interpolation, so the mustaches are
 *    escaped in the renderer rules below — the default theme's own
 *    templates are compiled by the same build and must keep normal
 *    delimiters, so the whole-site `delimiters` option is not an option.
 *
 * 2. The repository pins esbuild 0.28.2. VitePress ships Vite 5, whose
 *    default browser target makes that esbuild version fail while
 *    lowering destructuring. The docs site is built locally for a modern
 *    browser, so the target is raised instead.
 */
import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "zh-CN",
  title: "Mirrai",
  description: "不在身边的时候，TA 还在这里——上传聊天记录，重建 TA 的数字分身。",

  /**
   * Keep literal `{{ }}` out of the Vue compiler.
   *
   * Fenced code is already safe (VitePress wraps it in `v-pre`); prose
   * and inline code are not.
   */
  markdown: {
    config(md) {
      const escapeMustache = (html: string) => html.replace(/\{\{/g, "&#123;&#123;");
      const wrap = (name: "text" | "code_inline") => {
        const rule = md.renderer.rules[name];
        if (!rule) return;
        md.renderer.rules[name] = (tokens, index, options, env, self) =>
          escapeMustache(rule(tokens, index, options, env, self));
      };
      wrap("text");
      wrap("code_inline");
    },
  },

  /** The esbuild 0.28.2 pin cannot lower to Vite 5's default target. */
  vite: {
    build: { target: "es2022" },
    optimizeDeps: { esbuildOptions: { target: "es2022" } },
  },

  /**
   * Dead links stay checked. The only exception is the release notes that
   * link to `http://localhost:3000` (a local install address, not a page
   * of this site). Links to repository files outside `docs/` are written
   * as code, not as links, so the site has none of those.
   */
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  themeConfig: {
    nav: [
      { text: "产品概念", link: "/product-concept" },
      {
        text: "路线图",
        items: [
          { text: "第六阶段（当前）", link: "/roadmap-v6" },
          { text: "第五阶段", link: "/roadmap-v5" },
          { text: "第四阶段", link: "/roadmap-v4" },
          { text: "第三阶段", link: "/roadmap-v3" },
          { text: "第二阶段", link: "/roadmap-v2" },
        ],
      },
      { text: "执行文档", link: "/exec-v6" },
      { text: "API", link: "/api" },
      { text: "命令行", link: "/cli" },
      { text: "MCP", link: "/mcp" },
      { text: "插件", link: "/plugins" },
      { text: "备份", link: "/backup" },
      { text: "出站清单", link: "/egress" },
    ],
    sidebar: [
      {
        text: "产品",
        items: [
          { text: "产品概念", link: "/product-concept" },
          { text: "创作手记", link: "/creation-story" },
        ],
      },
      {
        text: "路线图",
        items: [
          { text: "第二阶段", link: "/roadmap-v2" },
          { text: "第三阶段", link: "/roadmap-v3" },
          { text: "第四阶段", link: "/roadmap-v4" },
          { text: "第五阶段", link: "/roadmap-v5" },
          { text: "第六阶段", link: "/roadmap-v6" },
        ],
      },
      {
        text: "执行",
        items: [
          { text: "第六阶段施工与验收手册", link: "/exec-v6" },
          { text: "第六阶段进度", link: "/exec-v6-progress" },
          { text: "建议池", link: "/ideas-v6" },
        ],
      },
      {
        text: "接口与集成",
        items: [
          { text: "OpenAI 兼容端点", link: "/api" },
          { text: "命令行", link: "/cli" },
          { text: "MCP 服务", link: "/mcp" },
          { text: "本机插件", link: "/plugins" },
        ],
      },
      {
        text: "运维",
        items: [
          { text: "完整备份与还原", link: "/backup" },
          { text: "出站清单", link: "/egress" },
          { text: "数据库静态加密", link: "/encryption" },
          { text: "macOS 安装包构建", link: "/macos-build-guide" },
          { text: "Windows 安装包构建", link: "/windows-build-guide" },
        ],
      },
      {
        text: "评测与发布",
        items: [
          { text: "标答与基线", link: "/eval/baseline" },
          { text: "盲测", link: "/eval/blind-test" },
          { text: "v1.1.0", link: "/releases/v1.1.0" },
          { text: "v1.2.0", link: "/releases/v1.2.0" },
          { text: "v1.3.0", link: "/releases/v1.3.0" },
          { text: "v1.4.0（草稿）", link: "/releases/v1.4.0-draft" },
        ],
      },
      {
        text: "其它",
        collapsed: true,
        items: [
          { text: "Agent Mission", link: "/AGENT-MISSION" },
          { text: "交接文档", link: "/HANDOFF" },
          { text: "交接文档（第二会话）", link: "/HANDOFF-2" },
          { text: "新会话提示词", link: "/SESSION-PROMPT" },
          { text: "下一次会话", link: "/NEXT-SESSION" },
          { text: "还没做完的", link: "/open-items" },
          { text: "第四轮审计", link: "/audit-4-whole-journey" },
          { text: "手机原生外壳", link: "/native-shells" },
        ],
      },
    ],
  },
});
