# magic-cc-codex-worker

[![CI](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/wenqingyu/magic-cc-codex-worker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](tsconfig.json)

**语言:** [English](README.md) · 简体中文

> 一个 Claude Code 插件，将 **[Codex](https://github.com/openai/codex) 打造成一池可被调度的代理工人** —— 直接在 Claude Code 内部启动、追踪、恢复、审阅、合并 Codex 会话。

## 为什么使用它?

- 🎯 **Claude Code 系统化调度 Codex 代理的最佳方案。** 不是把提示词简单转发给单次 Codex 调用的薄壳,而是一整套编排层:基于角色的专业化、git worktree 隔离、可恢复的会话、并行扇出、一流的会话追踪。每一次委派都经过调优、沙盒化、可观察。
- 💰 **节省并平衡你的 Claude Code 配额。** 把长时间运行的实现、审阅和规划任务交给 Codex —— 让 Claude 专注编排。Claude 预算走得更远,Codex 承担繁重工作。一个旋钮(`minimal` / `balance` / `max`)控制分配比例,最大化你的整体预算用于更多、更高质量、更复杂的工作。
- 🔀 **两个模型胜过一个。** 在 Claude 自己的审阅之外同时启动 Codex(GPT)审阅员 —— 不同模型家族会发现不同类别的 bug。插件通过独立的 git worktree 物化 PR 内容,审阅员能直接检查真实文件,而不是一个 diff 片段。
- 🧰 **真实工程化,不是玩具。** 62 个单元测试,严格 TypeScript,CI 覆盖 Node 20/22。基于对 Codex 实际 MCP 协议的技术验证设计 —— 没有 stdout 解析,没有脆弱的抓取。并行靠 git worktree,传输靠 MCP 协议,配置靠 TOML,执行靠沙盒。

**典型场景** —— 让长时间实现任务出堂外运行,不吃掉 Claude 的上下文 • 在独立子任务上扇出并行 Codex 工人 • 在 PR 上获取一份 GPT 的第二意见审阅,与 Claude 的审阅并排比较 • 跨会话恢复命名代理。

---

## 快速开始

### 一条提示词完成安装(推荐)

把下面这段话粘贴进任意 Claude Code 会话 —— Claude 会自动克隆、构建、注册并验证插件:

> 请帮我安装 `magic-cc-codex-worker` 插件,仓库地址 `https://github.com/wenqingyu/magic-cc-codex-worker`:
> 1. 克隆到 `~/.claude/plugins-local/magic-cc-codex-worker`(目录不存在就创建)。
> 2. `cd` 进去运行 `npm install && npm run build`。
> 3. 注册:运行 `/plugin marketplace add ~/.claude/plugins-local/magic-cc-codex-worker`。
> 4. 安装:`/plugin install magic-cc-codex-worker@magic-cc-codex-worker`。
> 5. 如果提示重启 Claude Code 就重启,然后运行 `/codex-status` 验证(应该返回"没有代理")。在启动真实代理之前,确认 `codex` CLI 已认证(`codex --version` 可成功)。

### 手动安装

```bash
# 前置条件: Node 20+、git 2.40+、已认证的 codex CLI
codex --version          # 任意 0.122.0+ 即可
git clone https://github.com/wenqingyu/magic-cc-codex-worker ~/.claude/plugins-local/magic-cc-codex-worker
cd ~/.claude/plugins-local/magic-cc-codex-worker
npm install && npm run build
```

然后在 Claude Code 会话里:

```
/plugin marketplace add ~/.claude/plugins-local/magic-cc-codex-worker
/plugin install magic-cc-codex-worker@magic-cc-codex-worker
```

### 首次使用

```
/codex-spawn implementer "为 /api/upload 添加限流"
# → 返回 agent_id,例如 codex-impl-ab12cd

/codex-status                         # 查看所有代理
/codex-status codex-impl-ab12cd       # 查看单个代理
/codex-merge codex-impl-ab12cd        # 完成后把 worktree 合并回来
```

核心循环就这么简单:启动 → 轮询 → 合并。

---

## 工作原理

插件内置两个 MCP 服务:

1. **`codex mcp-server`**(来自 Codex 本身)—— 原样暴露,用作 60 秒以内的同步快速路径。
2. **`codex-team`**(本项目)—— 异步编排:后台启动、跟踪状态、管理 git worktree、强制超时、回收结果。

每个 implementer 角色的代理都在独立的 git worktree 中运行,因此并行代理不会互相覆盖改动。reviewer 角色只读运行,当给出 `pr_number` 时会在 PR head SHA 的分离态 worktree 中工作。

---

## MCP 工具

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
| `/codex-spawn <role> <prompt>` | 启动一个代理。 |
| `/codex-status [agent_id]` | 紧凑进度表。 |
| `/codex-resume <agent_id> <prompt>` | 续跑终态代理。 |
| `/codex-cancel <agent_id> [--force]` | 终止 + 可选清理。 |
| `/codex-merge <agent_id>` | 合并回来。 |
| `/codex-discard <agent_id>` | 删除 worktree + 分支。 |
| `/codex-review-pr <pr_number>` | 对 PR 启动双模型代码审阅。 |
| `/codex-fan-out <EPIC-NNN>` | 为 epic 的每个子任务并行启动 implementer。 |
| `/codex-mode [minimal\|balance\|max]` | 查看/设置委派级别。 |

## 子代理(Subagents)

用于 `Agent({ subagent_type: "...", ... })` 调度:

- `codex-implementer` —— 自主 worktree 工作 + diff 审阅
- `codex-reviewer` —— 只读双模型审阅
- `codex-planner` —— 仅规划,供对比

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
export CODEX_TEAM_DELEGATION_LEVEL=max
```

```toml
# 仓库根目录 codex-team.toml(团队共享,提交到 git)
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
# codex-team.toml
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
/codex-review-pr 456
```

1. 插件运行 `gh pr view 456 --json headRefOid,headRefName,baseRefName,title,url`。
2. 在 `.codex-team/worktrees/<agent_id>` 下,于 PR head SHA 创建一个**分离态** git worktree。
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

- `.codex-team/state.json`(gitignored)—— 代理注册表、状态、`thread_id`、worktree 信息。MCP 重启后仍存活。
- `.codex-team/worktrees/<agent_id>/` —— 每个代理的 worktree。完成后保留,直到 `/codex-merge` 或 `/codex-discard`。
- `ops/workers.json` —— MF 模式下的 worker 注册表镜像。

---

## 配置参考

所有文件均可选。按以下顺序合并(后者优先级更高):

1. `src/roles/defaults/*.toml`(内置)
2. `~/.codex-team/config.toml`(用户全局)
3. `<repo>/codex-team.toml`(项目提交)
4. `<repo>/.codex-team/roles.toml`(项目个人,gitignored)
5. 单次调用的 `overrides`

完整示例见 [`codex-team.toml.example`](codex-team.toml.example)。

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
- 在 `/codex-merge` 之前务必审阅每个 worktree 的 diff。
- 插件不会主动推送到远程。PR 创建被刻意留给用户。
- 没有提供凭据(`LINEAR_API_KEY`、`gh auth`)时,插件不会访问 Linear 或 GitHub。

---

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。要求:提供测试、严格 TypeScript、小规模 PR。

## 许可证

[MIT](LICENSE) © magic-cc-codex-worker contributors。

**Magic Stack** 生态的一部分 —— 面向生产级项目的代理自主开发栈。
