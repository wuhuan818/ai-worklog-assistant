# AI Worklog Assistant

> AI Worklog Assistant 是一个运行在 VS Code 中的 AI 工作记录与知识沉淀助手，将真实开发活动整理为结构化工作上下文，经 AI 总结和人工审核后沉淀为可检索知识。

## 选题背景

开发中的排查过程、文件编辑、Diagnostics、Bug 和临时备注往往分散在不同工具中。任务结束后，开发者需要依赖记忆补写日志；即使借助 AI Chat，也不代表内容已经过审核并能成为长期知识。AI Worklog Assistant 的目标是让用户在明确开始任务后，把实际发生的开发活动组织为可复盘、可审核、可复用的信息。

## 核心功能

```text
开始任务
→ 记录开发活动
→ Bug / Note
→ Context Package
→ AI Summary
→ Revision
→ Review
→ Markdown Export
→ Knowledge Publication
→ Retrieval / RAG
```

- 用户显式开始和结束任务；
- 任务期间捕获文件编辑/保存活动、VS Code Diagnostics、VS Code Task、Debug、Bug 生命周期和手工备注；
- 文件事件保存语言、编辑计数、字符/行数变化、文件大小、时间和经规范化的路径等活动元数据，不保存源码正文、具体修改行或真实代码 Diff；
- 普通 VS Code Integrated Terminal 的手工命令和输出不属于当前自动采集范围；
- 结束任务后，系统构建可预览、脱敏并受预算控制的 Context Package；
- Ready Context 可以请求 AI 生成结构化总结，并进入人工修订与审核流程。

## 演示案例：修复 C++ Hello World 标识符错误

本次演示任务为“修复 Hello World 启动错误并完善问候输出”。初始代码中使用了未声明的 `userName`：

```cpp
std::cout << greet(userName) << std::endl;
```

用户在 VS Code 中完成实际排查与修复，并通过编译器 Diagnostics 验证问题消失。系统记录的是该任务中真实发生的文件编辑/保存活动、Bug、Diagnostics 和用户补充信息；它不会自动读取 C++ 源码的修改前后正文。

## AI 结构化总结与人工审核

```text
AI Draft → Revision → Approved
```

AI 只能使用用户确认的 Ready Context 生成结构化 Draft。原始 Draft 不被直接覆盖；用户的调整会保存为新的 Revision，只有 Approved Revision 才成为正式版本，并可用于导出或发布知识。这一边界让 AI 生成内容与人工确认结果保持清晰可追溯。

## 知识沉淀与复用

```text
Approved Revision
→ Knowledge Candidate
→ User Selection
→ Published Knowledge
→ Search / RAG
```

并非所有 AI 内容都会自动进入知识库。用户选择真正有价值的候选后才发布为 Published Knowledge；它才是本地检索、语义/混合检索和带引用 RAG 问答的正式知识源。

## 技术架构

- VS Code TypeScript Extension：侧边栏、命令、VS Code 活动事件与 SecretStorage；
- Python / FastAPI Local Backend：本地业务服务与受控 AI 调用；
- SQLite：任务、事件、审核、发布与检索数据的本地存储；
- Windows Packaged Backend EXE + VSIX：安装 VSIX 后无需单独部署 Python 或手工启动服务；
- Chat：DeepSeek、Qwen、Custom OpenAI-compatible；Embedding：Qwen、Custom OpenAI-compatible；
- Retrieval：Lexical、Semantic、Hybrid，以及带 Citation Validation 的单轮 RAG Answer。

## 隐私与安全

项目采用 Local-first、最小化外发和用户控制原则。API Key 使用 VS Code SecretStorage；工作数据本地保存于 SQLite；只有 Ready Context 才可用于 AI Summary。路径会规范化/脱敏，系统不持久化 `reasoning_content`、Provider 原始 Response 或完整 Prompt。使用外部 Chat 或 Embedding Provider 时，仅在用户触发相应操作后发送经过限定的 Context 或 Published Knowledge 片段。

## AI 使用心得

本项目并非通过一次 Prompt 自动生成。ChatGPT 用于产品方向、功能拆解、架构边界、验收标准和材料统筹；Codex 用于阅读代码、实现、Bug 修复、自动化测试、打包与 Git 闭环；用户负责产品判断、真实 UI/Provider 验收和最终截图。实际协作遵循：

```text
规划 → 实现 → 自动验证 → 人工验收 → 暴露问题 → 定向修复 → 再验证
```

这种分工让 AI 承担工程执行与高频验证，而由人保留产品判断和最终验收责任。

## 演示说明

本次提交采用真实截图演示，不提交视频。截图围绕 C++ Hello World Bug 修复任务，展示任务记录、Bug、AI 结构化总结、Revision / Review、Markdown 导出、知识发布、知识搜索和带引用的知识问答。

## 后续方向

未来可在隐私与大小控制前提下，增加更细粒度的代码差异采集、更多开发工具事件接入和多轮知识助手能力；这些均不属于当前提交版本已实现的能力。
