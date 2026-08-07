# AI Worklog Assistant — Phase 1 Submission Context

> 用途：为第一阶段比赛材料整理提供统一上下文。
> 本文件不是开发日志，也不是最终参赛介绍稿；它用于让 Codex 在整理 README、项目介绍、截图清单、演示脚本和最终提交目录时，理解产品定位、完整架构、关键设计决策与应突出亮点。

## 1. 产品定位

**AI Worklog Assistant** 是一个面向开发者的 VS Code 工作记录与知识沉淀助手。

它解决的问题不是“再做一个聊天机器人”，而是把开发过程中原本零散、容易丢失的信息自动组织起来：

- 任务开始与结束时间
- 文件变化与 Diff 摘要
- 终端命令及结果
- VS Code Task / Debug / Diagnostic
- 用户备注
- Bug 生命周期与解决方案
- AI 结构化总结
- 人工编辑、审核与批准
- Markdown 导出
- 知识候选发布
- 已发布知识检索
- 基于已发布知识的 RAG 问答

最终希望形成一条完整链路：

```text
开发过程
→ 自动记录
→ Context Package
→ AI Summary Draft
→ Revision
→ Review
→ Export / Knowledge Publication
→ Retrieval
→ RAG Answer
```

核心价值是：**让开发过程本身自动沉淀为可复用知识，而不是依赖开发者事后回忆和手工整理。**

## 2. 用户使用方式

产品采用“用户显式开始任务 / 结束任务”的方式。

典型流程：

1. 用户在 VS Code 中点击“开始任务”。
2. 开发过程中系统持续记录文件变化、命令、诊断、备注和 Bug。
3. 用户结束任务。
4. 系统构建经过脱敏和预算控制的 AI Context Package。
5. 用户确认后调用真实 AI Provider 生成结构化总结。
6. 用户在 Review Panel 中查看、修改并保存 Revision。
7. 用户批准最终版本。
8. 批准后的内容可以导出任务总结 Markdown、导出日报、选择性发布知识候选。
9. 已发布知识进入本地检索系统。
10. 用户可以搜索知识，或通过 RAG 基于已发布知识进行问答。

这种设计避免了无边界后台监控，也让“什么时候开始记录、什么时候停止记录”始终由用户控制。

## 3. 当前最终技术架构

```text
VS Code TypeScript Extension
        │
        │ local HTTP
        ▼
Python / FastAPI Local Backend
        │
        ├─ SQLite
        │   ├─ tasks / events / bugs
        │   ├─ context packages
        │   ├─ AI drafts / revisions / reviews
        │   ├─ export / publication records
        │   ├─ lexical retrieval index
        │   └─ semantic embedding index
        │
        ├─ Packaged Windows Backend EXE
        │
        ├─ Chat Providers
        │   ├─ DeepSeek
        │   ├─ Qwen
        │   └─ Custom OpenAI-compatible
        │
        └─ Embedding Providers
            ├─ Qwen
            └─ Custom OpenAI-compatible
```

正式交付形态：

```text
VSIX
└─ 内置 ai-worklog-server.exe
```

用户安装 VSIX 后，不需要另行安装 Python、FastAPI 或手动启动后端。

## 4. 核心功能

### 4.1 任务生命周期

- 手动开始任务
- 手动结束任务
- 任务状态：active / completed / cancelled
- 任务历史可重新打开
- Review 状态与任务执行状态独立

批准总结后，任务仍保持 `completed`，不会混用旧的 `confirmed` 状态。

### 4.2 工作过程采集

系统记录：

- 任务时间
- 文件变化
- Diff 摘要
- 终端命令
- VS Code Task
- Debug
- Diagnostic
- 备注
- Bug 生命周期

这些信息不是直接全部发送给 AI，而是先进入本地结构化数据链路。

### 4.3 Bug 生命周期

Bug 可以被创建、更新、解决并保留解决方案，最后纳入 AI 总结。

这使“报错 → 分析 → 修复 → 验证”能够成为可沉淀的开发知识，而不是只存在于临时聊天中。

### 4.4 AI Context Package

AI 不直接读取整个工作区。

系统先生成版本化 Context Package：

```text
task-context-package/v1
```

特性包括：

- 只包含允许发送的数据
- 隐私脱敏
- 绝对路径移除
- 确定性排序
- 去重
- Token / 字符预算
- 裁剪
- Provenance
- Preview / Ready / Superseded
- SQLite 持久化

只有 **Ready Context** 才能进入正式 AI Summary Generation。

### 4.5 AI Summary Generation

支持 DeepSeek、Qwen、Custom OpenAI-compatible。

AI 输出为八类结构化内容：

1. 任务总结
2. 代码变更
3. 命令与结果
4. Bug 解决方案
5. 未解决问题
6. 待办
7. 日报
8. 知识候选

正式链路包含 Generation Job、幂等、取消、Interrupted 状态、JSON 结构校验、Evidence Ref 校验、输出脱敏和 SQLite 持久化。

不保存原始 Provider Response、reasoning_content 或完整 Prompt。

## 5. AI Draft / Revision / Review 设计

关键设计决策：**AI 原始草稿不可变。**

```text
AI Draft
→ Revision
→ Review
```

- Draft 保存 AI 原始结构化输出，不允许用户覆盖。
- 用户修改后创建新的 Revision。
- Review 状态独立为 pending / approved / rejected。
- 只有 approved Revision 才能正式导出和发布知识。

这保证了 AI 生成内容和人工确认内容之间有明确边界。

## 6. 用户界面设计原则

后端继续保存结构化 JSON，但普通用户不需要编辑 JSON。

八类总结内容在前端通过中文业务表单展示：

- 文本框
- 多行文本
- 数组逐项编辑
- 对象卡片
- Evidence Ref 默认折叠并只读

例如任务总结对用户呈现为：

```text
任务总结

总结内容：
[......]

完成结果：
1. [...]
2. [...]

证据来源：2 条
[展开查看]
```

而不是内部 JSON。

## 7. Evidence / Provenance

Evidence Ref 用于追溯 AI 总结依据，但属于后台可信链路，不属于普通正文。

因此：

- 后端保留
- Revision 保存时自动继承
- 用户默认不编辑
- UI 折叠、只读
- AI 引用必须经过校验
- 不允许模型伪造不存在的引用

## 8. 导出与知识发布

### 用户导出

任务总结和日报属于“用户文件导出”。

```text
approved Revision
→ 后端生成 Markdown
→ VS Code Save Dialog
→ 用户选择保存位置
→ 打开文件 / 在资源管理器中显示
```

### 知识发布

知识发布属于系统管理知识库：

```text
approved Revision
→ knowledge candidate
→ 用户逐条选择
→ 发布前编辑
→ knowledge publication
→ managed Markdown
→ SQLite publication
```

知识候选默认不会全部自动发布。

## 9. Published Knowledge

后续检索和 RAG 的权威知识源只有：

```text
Published Knowledge
```

不直接使用 AI Draft、pending/rejected Revision、未发布 knowledge candidate、原始任务事件或 Provider 原始响应。

## 10. 本地知识检索

Stage 11A 建立本地 Published Knowledge Retrieval，支持：

- 中文搜索
- 英文搜索
- 中英混合
- 分类过滤
- stable ranking
- superseded publication 排除
- citation / source_ref
- backend restart 后恢复

检索完全本地，不需要外部 API。

## 11. Semantic / Hybrid Retrieval 与 RAG

Stage 11B 在本地 lexical retrieval 上叠加语义能力，而不是替换本地检索。

### Embedding 与 Chat Provider 分离

Chat Provider：

- DeepSeek
- Qwen
- Custom OpenAI-compatible

Embedding Provider：

- Qwen
- Custom OpenAI-compatible

### Semantic Index

- SQLite float32 vector storage
- deterministic chunking
- embedding profile fingerprint
- cosine similarity
- restart recovery

### Hybrid Retrieval

采用 lexical + semantic 融合；Embedding 不可用时自动 lexical fallback。

### RAG Answer

```text
User Query
→ Retrieval
→ Published Knowledge Context
→ Chat Provider
→ Structured Answer
→ Citation Validation
```

AI 只能引用本次实际检索到的 `source_ref`。

无检索证据时，不调用模型编造答案，而是明确提示知识不足。

## 12. 隐私与安全设计

产品原则：**本地优先、最小化外发、明确用户控制。**

### 本地保存

SQLite 保存任务记录、Bug、Context、Draft / Revision / Review、Published Knowledge、lexical index 和 semantic vectors。

### Secret

API Key 只通过 VS Code SecretStorage 使用，不写入 SQLite、Git、日志或 Markdown。

### 禁止持久化

- Authorization
- 完整 Prompt
- Provider 原始 Response
- reasoning_content
- 用户绝对路径

### AI 外发边界

Summary Generation：只有用户确认后的 Ready Context 被发送。

Embedding：只有用户显式启用后，Published Knowledge 才会发送到配置的 Embedding Provider。

RAG：只有用户主动提问后，本次实际检索到的 Published Knowledge 摘要才进入 Chat Provider Context。

## 13. Windows 后端生命周期

项目将 FastAPI 后端打包为 Windows EXE，并处理：

- awaitable deactivate
- `/runtime/shutdown`
- parent watchdog
- runtime registry
- orphan cleanup
- multi-instance isolation
- graceful shutdown
- bounded wait
- terminate fallback
- kill 最终兜底
- packaged backend verification ownership

最终要求：

```text
关闭 VS Code / verification 结束
→ owned backend = 0
```

## 14. 最终交付形态

### VSIX

```text
ai-worklog-assistant-0.1.1.vsix
```

可通过 VS Code `Extensions → Install from VSIX` 安装，内含正式 packaged backend EXE。

### Source ZIP

完整工程源码包，排除 `.git`、node_modules、venv、cache、runtime DB、用户知识、日志、`.env`、Secret 和本机绝对路径数据。

## 15. 项目开发阶段摘要

- Stage 1–6：Extension Shell、Backend Lifecycle、Task Lifecycle、Event Capture、Bug Lifecycle、Data Continuity
- Stage 7：AI Provider Foundation
- Stage 7.1：Backend Shutdown Stability
- Stage 8：AI Context Package
- Stage 9：Real AI Summary Generation
- Stage 10：Revision / Review、Business Form UI、Markdown Export、Knowledge Publication、History Entry
- Stage 11A：Local Published Knowledge Retrieval
- Stage 11B：Semantic Retrieval、Hybrid Retrieval、RAG Answer、Citation Validation

最终比赛材料不建议按 Stage 1–11 写成长篇开发日志。

## 16. AI 在开发过程中的作用

### ChatGPT

承担：

- 产品方向讨论
- 功能拆解
- 阶段规划
- 架构边界
- 验收标准
- 风险分析
- 提交材料统筹

### Codex

承担：

- 阅读代码
- 实现功能
- 修复问题
- 运行测试
- 查看日志和数据库证据
- 构建 packaged backend
- Git commit / push
- 闭环验证

### 用户

承担：

- 产品方向最终判断
- 必要真实 UI 验收
- 真实 Provider 验收
- 最终截图和视频录制

整体方式：

```text
需求
→ 阶段拆分
→ AI 实现
→ 自动化验证
→ 人工验收
→ 暴露问题
→ 定向修复
→ 再验收
```

## 17. 第一阶段材料应突出什么

### 亮点 1：开发过程自动结构化

直接从 VS Code 工作过程获取文件修改、命令、Bug、诊断和备注。

### 亮点 2：AI 输出有人工审核链路

```text
AI Draft
→ Revision
→ Approved
```

### 亮点 3：知识沉淀形成闭环

```text
工作记录
→ AI 总结
→ 人工审核
→ Knowledge Publication
→ Retrieval / RAG
```

### 亮点 4：本地优先与安全边界

- SQLite 本地存储
- API Key SecretStorage
- Ready Context
- Path Redaction
- 不保存 reasoning
- Published Knowledge 才进入 RAG

## 18. 建议 Demo 场景

使用一个真实、易理解的 Demo，而不是 `AAAAABBBB` 测试数据。

任务：

```text
修复 Hello World 启动错误并完善问候输出
```

初始文件：

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}

console.log(greet(userName));
```

运行：

```text
node hello.js
```

产生：

```text
ReferenceError: userName is not defined
```

演示流程：

1. 开始 AI Worklog 任务。
2. 运行错误代码。
3. 创建 / 记录 Bug。
4. 修复为 `console.log(greet("World"));`
5. 再运行，输出 `Hello, World!`
6. 标记 Bug 已解决。
7. 添加有意义的备注。
8. 结束任务。
9. 生成 AI 总结。
10. 编辑 Revision。
11. 批准。
12. 导出 Markdown。
13. 发布一条知识候选。
14. 搜索知识。
15. 如条件允许，演示 RAG 引用。

建议备注：

```text
JavaScript 出现 ReferenceError 时，应优先检查变量是否在使用前声明、
变量名是否拼写一致，以及变量作用域是否正确。
```

## 19. 截图策略

最终建议 6–8 张。

Codex 负责规划截图清单、说明页面状态和每张图要证明什么；用户负责真实 VS Code 截图；Codex 最后统一命名、编号和引用。

候选：

1. AI Worklog Assistant 主界面
2. 任务记录 / Bug 修复
3. Context 或任务结束状态
4. AI 总结业务表单
5. Revision / Review Approved
6. 历史任务与总结
7. Markdown 导出
8. Knowledge Search / RAG（如实际内容准备完成）

## 20. 一分钟视频策略

视频最长约 1 分钟，采用高密度演示：

- 0–5 秒：项目名称 + 一句话定位
- 5–18 秒：开始任务、Hello World 报错、Bug、修复成功
- 18–33 秒：AI 结构化总结、Revision、Approved
- 33–45 秒：历史任务、Markdown 导出
- 45–57 秒：发布知识、搜索知识、如可用则 RAG 引用
- 57–60 秒：一句话收尾

建议收尾：

> 把每次开发过程，自动沉淀成下一次可以复用的知识。

视频不要等待真实 AI 网络响应；提前准备好适合切换的状态。

不要展示 API Key、JSON、SQLite、Git、后台日志、测试命令、reasoning 或内部 UUID。

## 21. 当前已知非阻塞缺口

### Stage 6 Extension Host E2E

测试宿主在 Suite 初始化阶段退出，长期存在，没有产品断言失败或与当前提交相关的新错误证据。

作为 `non-blocking known gap` 记录，第一阶段不再排查。

### Stage 11B 正向真实知识问答

Stage 11B 完成时知识库为空，因此真实 UI 只验证了“没有知识时明确提示知识不足”。

正向 RAG / Citation 已通过 Fake Provider、自动化与 packaged EXE 验证，但未进行已有真实 Published Knowledge 的 UI 人工验收。

Demo 阶段如成功发布 Hello World 知识，可顺带补一次真实正向展示；即使不补，也不重新开启 Stage 11B，除非发现新的真实产品错误。

## 22. 当前提交阶段原则

第一阶段截止临近。

```text
功能冻结
→ Demo 数据准备
→ 材料整理
→ 截图
→ 1 分钟视频
→ 最终提交检查
```

暂停 Stage 12。

只允许修复真正阻塞安装、演示、导出、安全或提交的问题。

## 23. Codex 整理比赛材料时的参考优先级

1. 当前正式仓库代码与最终提交分支
2. 本文件 `PHASE1_SUBMISSION_CONTEXT.md`
3. 当前 docs / README / Architecture / Data Model
4. 上一次比赛材料：`D:\desktop\天津--灵感工坊--姜良振`

上一次比赛材料只用于参考目录结构、文件命名、截图组织、Markdown 排版和最终 ZIP 层级，不得照搬旧项目业务内容。

## 24. 最终材料写作原则

- 面向评委，不面向项目维护者
- 先解释价值，再解释实现
- 使用真实 Demo
- 少写内部 Stage 编号
- 少展示 JSON、UUID、数据库细节
- 用一条完整用户链路串联功能
- 技术架构准确但不过度展开
- 强调 AI 与人工审核结合
- 强调隐私与本地优先
- 强调“工作过程 → 可复用知识”的闭环

最终一句话建议：

> AI Worklog Assistant 将 VS Code 中的真实开发过程自动记录、总结、审核并沉淀为可检索知识，让每一次问题解决都能成为下一次工作的上下文。
