# AI Worklog Assistant 提交材料与接入实例说明

## 提交包内容

```text
AI-Worklog-Assistant-Phase1-Submission/
├─ 项目介绍.md
├─ PACKAGING-REPORT.md
├─ PACKAGING-REPORT_CN.md
├─ package/
│  └─ ai-worklog-assistant-0.1.1.vsix
├─ source/
│  └─ AI-Worklog-Assistant-Source/
└─ materials/
   ├─ README.md
   └─ screenshots/
```

- `项目介绍.md`：产品背景、功能、架构、隐私边界和 AI 协作经验；
- `package/`：可直接安装的 VSIX；
- `source/`：直接展开的完整工程源文件；
- `screenshots/`：真实 C++ Demo 过程截图，保留原始文件；
- `PACKAGING-REPORT.md` / `PACKAGING-REPORT_CN.md`：英文打包验收记录及中文对应稿。

## 安装实例

1. 打开 VS Code。
2. 执行 **Extensions: Install from VSIX...**。
3. 选择 `package/ai-worklog-assistant-0.1.1.vsix`。
4. 安装完成后，确认活动栏中出现 **AI Worklog**。
5. 打开侧边栏，确认没有本地后端启动错误。

VSIX 已包含 Windows packaged backend，正常使用不需要单独安装 Python、FastAPI 或手工启动后端。

## Chat Provider 接入

AI Summary 和知识问答需要可用的 Chat Provider。执行命令：

```text
AI Worklog: 配置 AI Provider
```

当前支持：

- DeepSeek；
- Qwen；
- Custom OpenAI-compatible。

按界面填写 Profile、Endpoint、Model 和 API Key 后，执行：

```text
AI Worklog: 测试 AI 连接
```

连接测试只发送固定的合成测试内容，不包含任务、Bug、Note、事件或源码。Profile 元数据保存在 VS Code `globalState`，API Key 只保存在 VS Code SecretStorage。系统不会在不同 Provider 之间自动回退。

## Embedding Provider 接入（可选）

本地关键词搜索不需要 Embedding。只有需要 Semantic / Hybrid Retrieval 时，才执行：

```text
AI Worklog: 配置 Embedding Provider
AI Worklog: 测试 Embedding 连接
AI Worklog: 重建语义索引
```

Embedding 当前支持 Qwen 和 Custom OpenAI-compatible。启用并重建语义索引会把 Published Knowledge 的受控文本发送到用户配置的 Embedding Provider。若语义基础设施不可用，知识检索会明确回退到本地 Lexical Retrieval。

## 最小使用流程

1. 执行 **AI Worklog: Start Task**，输入任务名称。
2. 在 VS Code 中完成真实开发活动，并按需创建 Bug 或添加 Note。
3. 执行 **AI Worklog: End Task**。
4. 预览 AI Context，并将确认后的版本标记为 Ready。
5. 生成 AI Summary Draft。
6. 编辑并保存 Revision，审核后设为 Approved。
7. 导出任务总结或日报 Markdown。
8. 选择有价值的 Knowledge Candidate 并发布。
9. 使用 **AI Worklog: Search Knowledge Base** 搜索已发布知识；已配置 Provider 时可进一步使用 **AI Worklog: 问知识库**。

## C++ 演示实例

演示任务名称：

```text
修复 Hello World 启动错误并完善问候输出
```

初始代码使用了未声明的 `userName`：

```cpp
std::cout << greet(userName) << std::endl;
```

编译器报告标识符未声明。用户在真实 VS Code 工作区中记录 Bug、修复变量定义、确认 Diagnostics 消失并解决 Bug，随后完成 Context、AI Summary、Revision / Approved、Markdown 导出和知识发布流程。

截图位于 `materials/screenshots/`。这些图片是用户真实操作结果，文档不嵌入图片，也不对截图进行合成或内容修改。

## 当前采集边界

- 文件事件记录编辑/保存活动及其元数据，不保存修改前后源码正文、具体修改行或真实 Git-style Patch；
- 普通 VS Code Integrated Terminal 中手工输入的命令和输出不会被自动采集；
- VS Code Task 记录任务名称、类型、进程和退出状态等受支持元数据，不等同于完整终端历史；
- Diagnostics 可以记录严重级别、消息、来源、代码和位置等信息；
- AI Summary 只使用用户确认的 Ready Context。

## 最小验收建议

安装后至少确认：

1. AI Worklog 侧边栏可以正常打开；
2. 可以开始并结束一个任务；
3. 可以预览并确认 Context；
4. Provider 已配置时，可以生成 Summary Draft；
5. Approved Revision 可以导出；
6. Published Knowledge 可以被搜索。

更完整的构建、安装、哈希、安全与自动验证证据见根目录打包报告。
