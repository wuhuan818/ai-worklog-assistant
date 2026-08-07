# AI Worklog Assistant

> 让 VS Code 中的真实开发过程自动记录、总结、审核并沉淀为可检索知识。

## 项目简介

AI Worklog Assistant 是运行在 VS Code 内的本地优先工作记录与知识沉淀助手。它将用户显式开始的一段开发任务中的文件变化、命令结果、诊断、备注和 Bug 生命周期组织为结构化记录，再经受控 AI 总结与人工审核，形成可导出、可发布、可检索的知识闭环。

[待插入截图：主界面 / 当前任务]

## 选题背景

开发中的问题定位、修复过程和经验通常散落在终端、代码修改和临时沟通中，任务结束后难以准确复盘，更难在下一次遇到类似问题时复用。项目聚焦“开发过程容易丢失”这一痛点：不要求开发者事后重写日志，而是在用户明确开始任务后，辅助沉淀真实过程。

## 功能介绍与核心流程

`开始任务 → 记录事件与 Bug → 结束任务 → Context Preview / Ready → AI Summary Draft → Revision / Approved → Markdown 导出或知识发布 → 本地检索 / RAG`

- 任务、事件、Bug、备注与解决方案的本地结构化记录；
- AI Context Package 在发送前执行预览、脱敏与预算控制；
- 结构化 AI 总结，支持 Revision、批准和拒绝；
- 仅批准内容可导出 Markdown 或选择性发布为知识；
- Published Knowledge 支持本地关键词检索；配置 Embedding 后支持语义/混合检索与带引用的 RAG 问答。

[待插入截图：Bug 修复、AI 总结审核、Approved / 导出、知识搜索]

## 技术架构

VS Code TypeScript Extension 负责侧边栏、命令、事件感知与 SecretStorage；本地 Python/FastAPI 后端通过 loopback HTTP 提供服务；SQLite 保存结构化业务数据与索引；审核后知识以 Markdown 与索引形式管理。正式 VSIX 内置 Windows packaged backend，因此安装者不需要单独配置 Python 或手动启动服务。

## 隐私与安全

项目遵循本地优先、最小化外发和明确用户控制：API Key 只经 VS Code SecretStorage 使用；Context 在 Ready 前可预览并经过脱敏；不持久化 Authorization、完整 Prompt、Provider 原始响应或 reasoning 内容；RAG 仅以已发布知识作为权威来源。

## AI 协作开发心得

本项目不是“一次 Prompt 生成完整应用”。ChatGPT 用于产品规划、阶段拆分、架构边界与验收标准；Codex 用于实现、测试、构建与 Git 闭环；用户负责产品取舍和真实 UI 验收。实践过程是“规划 → 实现 → 自动验证 → 人工验收 → 定向修复 → 再验证”的协作循环。

## 演示说明

将使用真实 Hello World `ReferenceError` 修复任务演示：记录错误与 Bug、修复并验证、结束任务、生成并审核总结、导出 Markdown、发布和检索真实知识。演示截图与视频将在真实流程完成后插入。

[待插入截图]

## 项目亮点

1. 以真实开发过程为输入，而不是事后手工回忆。
2. AI Draft 与人工 Revision / Approved 分离，避免未审核内容直接成为正式知识。
3. 从工作记录到 Published Knowledge，再到 Retrieval / RAG 的完整闭环。
4. 本地优先的存储、密钥和 AI 外发边界设计。
