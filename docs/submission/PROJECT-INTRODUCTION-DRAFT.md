# AI Worklog Assistant

> AI Worklog Assistant 是一个运行在 VS Code 中的 AI 工作记录与知识沉淀助手，将真实开发活动整理为结构化工作上下文，经 AI 总结和人工审核后沉淀为可检索知识。

## 项目信息

- 产品形态：VS Code Extension + Windows 本地后端
- 适用场景：个人开发任务记录、Bug 复盘、日报整理与经验复用
- 交付形式：可安装 VSIX、完整工程源文件、项目介绍与真实演示截图
- 当前阶段：第一阶段功能冻结版本

## 选题背景

开发工作中真正有价值的信息，往往产生在排查和修改的过程中：文件发生了哪些活动、Diagnostics 暴露了什么问题、Bug 如何被确认和解决、开发者补充了哪些判断。它们通常分散在编辑器、任务面板和临时记录中，任务结束后只能依赖记忆重新整理。

普通 AI Chat 可以辅助解决局部问题，但聊天结果并不会自然变成经过审核、可追溯、可长期检索的工程知识。AI Worklog Assistant 因此关注的不是“再增加一个聊天窗口”，而是建立一条从真实开发活动到正式知识资产的受控链路。

## 项目目标

项目希望解决三个连续问题：

1. 在用户明确开始任务后，持续组织与该任务有关的开发活动；
2. 在任务完成后，使用经过预览和确认的上下文生成结构化总结，并由用户审核；
3. 将真正有复用价值的内容发布为知识，使后续搜索和问答能够引用已有经验。

产品并不追求无边界监控。当前版本记录文件编辑/保存活动元数据、Diagnostics、VS Code Task、Debug、Bug 生命周期和手工备注，不保存源码正文、具体修改行或真实代码 Patch，也不自动采集普通集成终端中的手工命令与输出。

## 核心使用流程

```text
开始任务
→ 记录开发活动与 Bug / Note
→ 构建并确认 Context Package
→ AI 生成结构化 Draft
→ 用户保存 Revision 并执行 Review
→ 导出 Markdown
→ 选择并发布 Knowledge Candidate
→ Search / RAG 复用 Published Knowledge
```

### 1. 任务与开发活动记录

用户显式开始、结束任务，系统在任务期间归集文件编辑/保存活动、VS Code Diagnostics、VS Code Task、Debug 以及人工补充的 Bug 和 Note。文件事件保存语言、编辑计数、字符或行数变化、文件大小、时间和规范化路径等元数据，让记录能够说明“开发过程中发生了什么”，同时避免把完整源码直接写入工作日志。

Bug 具有创建、切换、备注、解决和重新打开等生命周期。事件可以关联到当时活动的 Bug，使后续复盘不只是一个结果列表，还能保留问题处理脉络。

### 2. 可预览的 AI Context

任务结束后，系统从已持久化的记录构建版本化 Context Package。路径规范化、敏感内容过滤、去重和预算控制在本地完成；用户可以先预览，再将合适的版本标记为 Ready。只有 Ready Context 才能进入 AI Summary Generation，从流程上划定正式的模型输入边界。

### 3. AI 总结与人工审核

AI 根据 Ready Context 生成结构化 Draft，覆盖任务总结、开发活动、命令与结果、Bug 解决方案、遗留问题、待办、日报和知识候选等固定类别。生成结果不是最终结论：用户修改会形成新的 Revision，只有经过 Review 并标记为 Approved 的版本，才可以作为正式总结继续导出或发布。

```text
AI Draft → Revision → Approved
```

这种设计既利用 AI 降低整理成本，也保留了人与模型之间清晰的责任边界和版本依据。

### 4. Markdown 导出

Approved Revision 可以导出为任务总结或日报 Markdown。导出结果来自用户已确认的版本，适合继续归档、提交或纳入现有文档工作流，而不是直接输出未经检查的模型草稿。

### 5. 知识发布与复用

系统不会把所有 AI 内容自动写入知识库。用户从 Approved Revision 中选择值得保留的 Knowledge Candidate，发布后才成为正式的 Published Knowledge。

```text
Approved Revision
→ Knowledge Candidate
→ User Selection
→ Published Knowledge
→ Lexical / Semantic / Hybrid Retrieval
→ RAG Answer with validated citations
```

本地关键词搜索无需外部模型。用户显式配置 Embedding 后，可以为已发布知识建立语义索引；知识问答只使用检索到的 Published Knowledge 片段，并校验回答引用是否来自本次检索结果。

## 演示说明

本次提交采用真实截图演示，不提交视频。演示围绕“修复 Hello World 启动错误并完善问候输出”的 C++ 任务，覆盖任务开始、Bug 记录与解决、Context、AI Draft、Revision / Approved、Markdown 导出、知识发布、搜索和带引用问答。安装、Provider 接入和演示实例的具体操作见提交包 `materials/README.md`。

## 技术架构

- **VS Code TypeScript Extension**：提供侧边栏、命令、状态展示、VS Code 活动事件接入和 SecretStorage；
- **Python / FastAPI Local Backend**：承载任务、事件、审核、发布、检索和受控 AI 调用；
- **SQLite**：在本机保存工作记录、Context、Draft / Revision / Review、Published Knowledge 和检索索引；
- **Windows Packaged Backend EXE**：随 VSIX 一起交付，用户安装扩展后无需单独部署 Python 服务；
- **Provider 适配**：Chat 支持 DeepSeek、Qwen 和 Custom OpenAI-compatible，Embedding 支持 Qwen 和 Custom OpenAI-compatible；
- **知识检索**：支持 Lexical、Semantic、Hybrid Retrieval，以及带 Citation Validation 的单轮 RAG Answer。

扩展负责用户交互和密钥访问，本地后端负责数据一致性与业务规则，两者通过仅监听本机回环地址的服务通信。

## 隐私与安全

项目采用 Local-first、最小化外发和用户控制原则：

- 工作数据默认保存在本机 SQLite；
- API Key 由 VS Code SecretStorage 保存，不写入项目配置、SQLite、日志或 Markdown；
- Context 在本地完成路径规范化、脱敏与大小控制；
- 不持久化完整 Prompt、Provider 原始 Response 或 `reasoning_content`；
- AI Summary 只发送用户确认的 Ready Context；
- 语义索引只在用户显式启用后向所配置的 Embedding Provider 发送 Published Knowledge；
- 知识问答只发送问题及检索命中的已发布知识片段。

因此，“本地优先”并不等同于宣称所有数据永不离开本机；调用外部 AI 或 Embedding Provider 时，经过限定的数据会在用户触发相应操作后发送到其选定服务。

## 项目亮点

1. **记录来自开发现场**：信息在任务执行过程中形成，减少事后凭记忆补写；
2. **AI 结果必须人工确认**：Draft、Revision、Approved 状态明确，未经批准的内容不会直接成为正式知识；
3. **形成知识闭环**：总结不仅用于查看，还可经过选择、发布、检索和带引用问答再次复用；
4. **能力边界可解释**：产品明确区分活动元数据、AI 输入、正式知识与外部 Provider 数据边界；
5. **安装形态完整**：Windows 用户通过 VSIX 即可获得扩展和内置本地后端。

## AI 使用心得

本项目不是通过一次 Prompt 自动生成，而是由 ChatGPT、Codex 和用户持续协作完成。

- ChatGPT 主要参与产品方向讨论、功能拆解、架构边界、验收标准、风险分析和材料统筹；
- Codex 主要承担代码阅读、功能实现、Bug 修复、自动化测试、打包验证和 Git 闭环；
- 用户负责产品方向的最终判断、真实 UI 与 Provider 验收、Demo 操作和比赛截图。

实际协作遵循：

```text
规划 → 实现 → 自动验证 → 人工验收 → 暴露问题 → 定向修复 → 再验证
```

这种方式使 AI 更适合承担高频工程执行和验证工作，同时由人保留产品决策、风险判断和最终验收责任。

## 当前边界与后续方向

当前版本不采集真实代码 Patch 或普通终端历史，也不把 AI 输出自动发布为知识。后续可以在隐私与体积控制前提下探索更细粒度的代码差异采集、更多开发工具事件接入、多轮知识助手及更多 IDE / 工作平台支持；这些方向均不属于本次提交版本已经实现的能力。
