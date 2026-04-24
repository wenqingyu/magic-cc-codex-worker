# magic-cc-codex-worker

### 在 Claude Code 内并行运行 Codex workers。

[![CI](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-purple.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)

**语言:** [English](README.md) · 简体中文

> **把 Claude Code 变成一个多代理编码系统。** 把长时间运行的实现、审阅、规划任务委派给一池在并行、隔离的 git worktree 中运行的 Codex workers —— 无需离开 Claude Code 会话。

这是两个生态之间的桥梁:Claude 专注于编排模式(规划、综合、交互式工作),Codex workers 承担繁重任务。你提高吞吐量、保留 Claude 预算,并且在任何 worker 的产出触碰主工作树之前都可以完整审阅。

## 为什么使用它?

- ⚡ **并行执行。** 在 N 个隔离的 worktree 中扇出 N 个 Codex workers 处理彼此独立的子任务。完成在单次 Claude 会话里只能串行进行的工作。
- 🛡️ **隔离实验。** 每个 implementer 都在自己的 `git worktree` 和自己的分支上运行。并行尝试三种方案,保留最好的,丢弃其余 —— 主工作树零风险。
- 🔀 **两个模型胜过一个。** 在 Claude 自己的审阅之外同时启动 Codex(GPT)审阅员 —— 不同模型家族会发现不同类别的 bug。插件通过独立的 worktree 物化 PR 内容,审阅员能直接读取真实文件,而不是一个 diff 片段。
- 💰 **配额套利。** Claude 预算告急?把 delegation 调到 `max`,Codex 能处理的都走那边 —— Claude 留在编排模式。一个旋钮(`minimal` / `balance` / `max`)控制分配比例。
- 🎯 **角色调优、可观察的委派。** 不是"转发提示词"的薄壳 —— 一整套编排层:基于角色(implementer / reviewer / planner / generic)的专业化、可恢复的会话、每角色独立的沙盒和超时、持久化注册表中的一流会话追踪。
- 🧰 **生产级工程化。** 62 个单元测试、严格 TypeScript、CI 覆盖 Node 20/22。基于对 Codex 实际 MCP 协议的技术验证设计 —— 没有 stdout 解析,没有脆弱的抓取。并行靠 git worktree,传输靠 MCP 协议,配置靠 TOML,执行靠沙盒。

## 与官方插件对比

|                                         | 官方 Codex 插件 | **magic-cc-codex-worker** |
|-----------------------------------------|:---------------:|:-------------------------:|
| 在 Claude Code 中运行单个 Codex 会话     | ✅              | ✅                         |
| 多代理编排                              | ❌              | ✅                         |
| Worker 并行执行                         | ❌              | ✅                         |
| 每个 Worker 的 git worktree 隔离        | ❌              | ✅                         |
| 基于角色的专业化                        | ❌              | ✅                         |
| 可恢复的会话连续性                      | ❌              | ✅                         |
| 双模型 PR 审阅                          | ❌              | ✅                         |
| Epic / 批量扇出                         | ❌              | ✅                         |

官方 Codex 插件让你**用** Codex;本插件让你**规模化使用** Codex。

---

## 快速开始

### 两条斜杠命令完成安装

Claude Code 的插件分发采用两步模式 —— 类似 `brew tap` + `brew install` 或 `apt-add-repository` + `apt install`。先注册一个**市场**(marketplace,即插件目录),再从中**安装**某个插件。我们这个市场里只有这一个插件,所以名字看起来是重复的 —— 这是正常的。

#### 第 1 步 —— 注册市场目录

告诉 Claude Code:"这个 GitHub 仓库发布了一个插件目录"。它会克隆仓库的 `.claude-plugin/marketplace.json` 并列出该市场里可用的插件。此时还没有安装任何插件。

```text
/plugin marketplace add wenqingyu/magic-cc-codex-worker
```

#### 第 2 步 —— 从该市场安装插件

从目录中选出某个插件,将其挂载到你当前的 Claude Code 会话。`<插件名>@<市场名>` 的格式在多个市场存在同名插件时用于消除歧义。

```text
/plugin install magic-codex@magic-codex
```

#### 第 3 步 —— 重启 Claude Code

插件在下一次会话中自动启用。重启后运行 `/magic-codex:status` 验证 —— 应返回空的代理列表,并注册 9 个 `magic-codex` MCP 工具。

就这么简单:你这边不需要克隆、不需要构建、不需要配置。Claude Code 会拉取仓库、读取 `.claude-plugin/marketplace.json`,并用预构建好的 `dist/`、斜杠命令、子代理一并安装。

### 前置条件

只需要 `codex` CLI 本身已安装并认证:

```bash
codex --version          # 任意 0.122.0+ 即可
codex login              # 如果还未登录
```

Node / git / npm 仅在你想**开发**插件时才需要 —— 见下方 [开发](#开发) 部分。

### 首次使用

```
/magic-codex:spawn implementer "为 /api/upload 添加限流"
# → 返回 agent_id,例如 codex-impl-ab12cd

/magic-codex:status                         # 查看所有代理
/magic-codex:status codex-impl-ab12cd       # 查看单个代理
/magic-codex:merge codex-impl-ab12cd        # 完成后把 worktree 合并回来
```

核心循环就这么简单:启动 → 轮询 → 合并。

---

## 核心能力

- **并行任务执行** —— 同时启动 N 个 Codex workers,每个运行在独立的沙盒分支上。
- **隔离实验** —— 对同一个任务并行尝试多种方案;`/magic-codex:merge` 合并最好的,`/magic-codex:discard` 丢弃其余。主工作树永远不会被污染。
- **最优结果选择** —— 在任何改动进入主分支前,独立审阅每个 worker 的 diff。
- **会话可恢复** —— worker 完成后还需要追问?`/magic-codex:resume <agent_id>` 在同一个 Codex 线程中继续。
- **双模型审阅** —— 在 PR 上启动 Codex 审阅员;与你自己的 Claude 审阅并排阅读。
- **多代理工作流** —— 把 Linear epic 扇出到每个子任务一个 worker;作为批次收集结果。

## 工作原理

插件内置两个 MCP 服务:

1. **`codex mcp-server`**(来自 Codex 本身)—— 原样暴露,用作 60 秒以内的同步快速路径。
2. **`magic-codex`**(本项目)—— 异步编排:后台启动、跟踪状态、管理 git worktree、强制超时、回收结果。

每个 implementer 角色的 worker 都在独立的 git worktree 中运行,因此并行 workers 不会互相覆盖改动。reviewer 角色只读运行,当给出 `pr_number` 时会在 PR head SHA 的分离态 worktree 中工作。

---

## 技术参考 —— MCP 工具

| 工具 | 用途 |
|---|---|
| `spawn` | 在后台启动一个 Codex 代理,返回 `agent_id`。 |
| `status` | 单个或全部代理的当前状态 + 输出摘要。 |
| `result` | 终态代理的完整输出。 |
| `resume` | 通过 Codex `codex-reply` 在已保存的 `thread_id` 上继续终态代理。 |
| `cancel` | 杀掉运行中的代理并标记 `cancelled`。`force` 同时删除 worktree。 |
| `merge` | 把已完成的 implementer 的 worktree 分支合回 base_ref(squash / ff / rebase)。 |
| `discard` | 删除终态代理的 worktree 及其分支。 |
| `list` | 按 role / status / issue_id / has_pr / stale 年龄过滤代理。 |
| `get_delegation_policy` | 读取当前委派级别与每个级别的指南。 |

另外还透传 `codex mcp-server` 自身的 `codex` / `codex-reply` 工具。

## 斜杠命令

| 命令 | 用途 |
|---|---|
| `/magic-codex:spawn <role> <prompt>` | 启动一个代理。 |
| `/magic-codex:status [agent_id]` | 紧凑进度表。 |
| `/magic-codex:resume <agent_id> <prompt>` | 续跑终态代理。 |
| `/magic-codex:cancel <agent_id> [--force]` | 终止 + 可选清理。 |
| `/magic-codex:merge <agent_id>` | 合并回来。 |
| `/magic-codex:discard <agent_id>` | 删除 worktree + 分支。 |
| `/magic-codex:review-pr <pr_number>` | 对 PR 启动双模型代码审阅。 |
| `/magic-codex:fan-out <EPIC-NNN>` | 为 epic 的每个子任务并行启动 implementer。 |
| `/magic-codex:mode [minimal\|balance\|max]` | 查看/设置委派级别。 |

## 子代理(Subagents)

用于 `Agent({ subagent_type: "...", ... })` 调度:

- `implementer` —— 自主 worktree 工作 + diff 审阅
- `reviewer` —— 只读双模型审阅
- `planner` —— 仅规划,供对比

---

## 委派级别

Claude 应该多激进地把工作委派给 Codex?

| 级别 | 意图 |
|---|---|
| `minimal` | 只在 Codex 做得明显更好时使用(第二意见 GPT 审阅、超长运行)。 |
| `balance`(默认) | 均衡分配。Claude 处理轻量/交互工作;Codex 承担大块/可并行工作。 |
| `max` | Codex 能做的都交给 Codex;Claude 专注编排模式。 |

通过以下方式设置(优先级:env > project > user > default):

```bash
# 环境变量
export MAGIC_CODEX_DELEGATION_LEVEL=max
```

```toml
# 仓库根目录 magic-codex.toml(团队共享,提交到 git)
[delegation]
level = "balance"
```

Claude 在会话开始时通过 `get_delegation_policy` 读取策略。

---

## 角色

内置预设(`src/roles/defaults/`):

| 角色 | 沙盒 | Worktree | 超时 |
|---|---|---|---|
| `implementer` | `workspace-write` | 每代理独立分支 | 30 分钟 |
| `reviewer` | `read-only` | 当提供 `pr_number` 时在 PR head 分离态 worktree | 10 分钟 |
| `planner` | `read-only` | 无 | 15 分钟 |
| `generic` | `read-only` | 无 | 15 分钟 |

**模型选择。** 默认情况下,每个角色继承你 `~/.codex/config.toml` 所选的模型。可在角色级或单次调用级覆盖:

```toml
# magic-codex.toml
[roles.implementer]
model = "gpt-5-codex"        # 或 Codex 接受的任何模型名

[roles.reviewer]
model = "gpt-5"              # 双审阅模式下使用更强推理模型
timeout_seconds = 900
```

单次调用覆盖:

```json
{
  "role": "reviewer",
  "prompt": "...",
  "overrides": { "model": "gpt-5", "timeout_seconds": 1200 }
}
```

---

## PR 审阅流程

```
/magic-codex:review-pr 456
```

1. 插件运行 `gh pr view 456 --json headRefOid,headRefName,baseRefName,title,url`。
2. 在 `.magic-codex/worktrees/<agent_id>` 下,于 PR head SHA 创建一个**分离态** git worktree。
3. 启动 Codex,`sandbox: read-only`、`cwd` 为该 worktree,PR 上下文注入到 `developer_instructions`。

审阅员现在拥有真实的文件系统检出 —— 可以 grep、读取测试、查看代码上下文,而不只是一段 diff。与你自己的审阅(Claude 直接审阅或另外的审阅 skill)配合使用,得到两个独立视角。

---

## Magic Flow 集成

当仓库根目录存在 `.magic-flow/` 或 `ops/workers.json` 时自动启用。启用后:

- **Linear 增强** —— 若设置了 `LINEAR_API_KEY` 并传入 `issue_id`,issue 的标题/描述/URL 会填充到提示模板的占位符中。
- **分支命名** —— `feature/TEAM-NNN-<slug>`,而不是通用的 `codex/<suffix>`。
- **规范注入** —— 插件读取 `~/.claude/CLAUDE.md` 中的"Magic Flow Workflow Conventions"章节,注入到每次 Codex 启动的 `developer_instructions`,使代理遵循与 Claude 相同的分支/提交/Linear 规则。
- **Worker 注册表镜像** —— 每次状态转变都 upsert 进 `ops/workers.json`,使用兼容 MF 的 schema;`/mf-status` 自动抓取。

退出方式:删除上述标记。插件在非 MF 项目中能干净运行。

---

## 状态文件

- `.magic-codex/state.json`(gitignored)—— 代理注册表、状态、`thread_id`、worktree 信息。MCP 重启后仍存活。
- `.magic-codex/worktrees/<agent_id>/` —— 每个代理的 worktree。完成后保留,直到 `/magic-codex:merge` 或 `/magic-codex:discard`。
- `ops/workers.json` —— MF 模式下的 worker 注册表镜像。

---

## 配置参考

所有文件均可选。按以下顺序合并(后者优先级更高):

1. `src/roles/defaults/*.toml`(内置)
2. `~/.magic-codex/config.toml`(用户全局)
3. `<repo>/magic-codex.toml`(项目提交)
4. `<repo>/.magic-codex/roles.toml`(项目个人,gitignored)
5. 单次调用的 `overrides`

完整示例见 [`magic-codex.toml.example`](magic-codex.toml.example)。

---

## 开发

```bash
npm install
npm test                         # 62 个单元测试,约 3 秒
npm run typecheck                # 严格 TS
npm run build                    # 编译 + 资源拷贝
./scripts/smoke-tools-list.sh    # 验证 MCP server 列出全部 9 个工具

# 可选 —— 对接真实 codex 的集成测试(需要已认证):
RUN_CODEX_INTEGRATION=1 npm test
```

项目结构:

```
src/
├── index.ts              # MCP server 入口(stdio)
├── orchestrator.ts       # spawn/resume/cancel/merge/discard 生命周期
├── registry.ts           # 持久化代理状态
├── worktree.ts           # git worktree 创建/删除/合并/分离
├── roles/                # TOML 预设 + 加载器 + 模板
├── mcp/codex-client.ts   # MCP 客户端 → codex mcp-server
├── mf/                   # Magic Flow 集成(detect, linear, workers, github, conventions)
├── delegation.ts         # minimal / balance / max 策略
└── types.ts

commands/                 # 斜杠命令(markdown)
agents/                   # 子代理定义(markdown)
docs/plans/               # 设计与实现计划
tests/unit/               # 62 个单元测试
```

完整架构文档:[`docs/plans/2026-04-24-magic-cc-codex-worker-design.md`](docs/plans/2026-04-24-magic-cc-codex-worker-design.md)。

---

## 安全说明

- implementer 角色使用 `sandbox: workspace-write` —— Codex 可以在 worktree 内写文件,但不会接触主工作树。只有在你清楚知道自己在做什么时才使用 `danger-full-access`。
- 在 `/magic-codex:merge` 之前务必审阅每个 worktree 的 diff。
- 插件不会主动推送到远程。PR 创建被刻意留给用户。
- 没有提供凭据(`LINEAR_API_KEY`、`gh auth`)时,插件不会访问 Linear 或 GitHub。

---

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。要求:提供测试、严格 TypeScript、小规模 PR。

## 许可证

**[PolyForm Noncommercial 1.0.0](LICENSE)** © 2026 Wenqing Yu。

- **免费**用于独立开发者、业余项目、研究、教育、非营利组织 —— 可自由使用、修改、再分发,需保留出处声明。
- **商业用途**(营利公司、SaaS 集成、转售、或衍生产品的公开分发)需要单独的商业许可。详见 [COMMERCIAL.md](COMMERCIAL.md) 了解申请方式 —— 大部分情况会被快速友好地批准。
- **衍生作品 / 大量借用想法**:请在你的 README 中引用本项目(`Based on magic-cc-codex-worker by Wenqing Yu`)。这份感谢是我们重视的,并且在复制大量代码时许可证也要求这样做。

有疑问直接开 issue 询问即可 —— 比起繁琐的手续,我们更愿意直接批准你的使用场景。

**Magic Stack** 生态的一部分 —— 面向生产级项目的代理自主开发栈。本插件是它连接 Claude Code 与 Codex 生态的多代理桥梁。
