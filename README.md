# dsh-paper-vault

给 DeepSeek Harness 用的**本地优先论文库**。它保留 Agentero 最核心的几件事——找论文、入库、读笔记、引用——但不需要 Agentero CLI、桌面端或任何原生模块，只靠 Node 内置能力运行，因此手机上的 DSH 引擎也能装。

## 能做什么

- **arXiv 检索**：按关键词找候选论文，已在库里的自动排除。
- **按 arXiv / DOI / URL 导入**：拉取标题、作者、年份、摘要、DOI；来源公开 PDF 时一并下载到本地。直接给一个 `.pdf` 链接也可以导入。
- **本地库**：标签、已读/未读、按标题/作者/标签/DOI 搜索。
- **每篇一条 Markdown 笔记**：读、写、追加，并按笔记正文搜索。
- **BibTeX 引用**：只为库里真实存在的论文生成条目，不编造 DOI。
- **完全本地**：目录、PDF、笔记都在手机自己的 DSH 目录里，不经过第三方服务。

## 数据位置

默认：

```
$DSH_HOME/data/paper-vault/
  catalog.json      # 论文元数据
  pdfs/<id>.pdf     # 导入时能拿到的 PDF
  notes/<id>.md     # 每篇论文的笔记
```

插件也接受 `vault` 配置；相对路径按 `$DSH_HOME` 解析。

## 工具

| 工具 | 作用 |
|---|---|
| `paper_search_arxiv` | 搜 arXiv，返回候选（标题、作者、年份、摘要、arXiv id） |
| `paper_import` | 按 arXiv id、DOI 或论文 URL 导入；能下 PDF 就下 |
| `paper_list` | 列出本地论文，可按关键词、标签、未读筛选 |
| `paper_show` | 看一篇的完整元数据、摘要、PDF 路径和笔记 |
| `paper_update` | 加/删标签，标记已读 |
| `paper_note` | 读/写/追加这篇论文的 Markdown 笔记 |
| `paper_notes_search` | 在所有笔记正文里搜索 |
| `paper_cite` | 生成 BibTeX（按 ids、查询或全部） |

所有工具都只通过 `ctx.tools` 注册，没有客户端 UI、没有后台任务、没有网络监听。

## 安装

从 GitHub 源码仓库安装（尚未发布 npm）：

```sh
dsh plugin add https://github.com/lazy-fur2025/dsh-paper-vault
```

或直接用 Release 里的 tarball：

```sh
dsh plugin add https://github.com/lazy-fur2025/dsh-paper-vault/releases/download/v0.1.2/dsh-paper-vault-0.1.2.tgz
```

本地打包：

```sh
npm pack
# 得到 dsh-paper-vault-0.1.2.tgz，在 DSH 的「扩展 → 安装」里选择或粘贴它
```

Android 上也可以用局域网/本机 HTTP 提供 `.tgz`，在扩展安装框里填完整 URL。

## 与 Agentero 的取舍

保留：本地 Vault、arXiv 发现与导入、DOI/URL 元数据、标签、论文笔记、笔记搜索、BibTeX。

有意不做：Agentero 桌面端的 PDF 阅读/批注/OCR、全文翻译、React 侧边栏；这些需要它的 CLI、PDFium 和 web 前端。这里的 PDF 会落盘并给出绝对路径，交给手机上的阅读器打开。

## 测试

```sh
node --test "test/*.test.js"
```

`test/live-smoke.mjs` 和 `test/plugin-smoke.mjs` 会访问 arXiv/Crossref；它们用于手动验证网络链路，不属于默认测试。
