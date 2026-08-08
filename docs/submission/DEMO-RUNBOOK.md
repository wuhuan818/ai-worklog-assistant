# AI Worklog Assistant — Hello World Demo Runbook

目标：由用户完成一条真实开发记录，而不是预置测试数据。预计 12–18 分钟；AI Provider 的生成时间不计入此估算。

## 开始前

1. 在 VS Code 使用 **Extensions: Install from VSIX...** 安装正式 VSIX（若尚未安装）。
2. 打开 Demo 文件夹 `<Demo-Workspace>\hello-world`（本机准备目录）。只打开这个文件夹，避免记录到其他工作区。
3. 打开 Activity Bar 中的 **AI Worklog**，保持侧边栏可见；确认“后端状态”为健康后再继续。
4. 不展示或录制 API Key、Provider 配置页、Output 日志、数据库或 VS Code 的全局设置。

## 真实 Demo 操作

1. 通过 Command Palette 执行 **AI Worklog: Start Task**，按向导填写任务名：`修复 Hello World 启动错误并完善问候输出`。
2. 保持 AI Worklog 侧边栏打开，打开 `hello.cpp`。
3. 在集成终端执行 `g++ hello.cpp -o hello.exe`，确认出现类似 `error: 'userName' was not declared in this scope` 的编译错误。

   **[截图点 1：错误与当前任务]** 保持终端错误、`hello.cpp` 和 AI Worklog 侧边栏同时可见；不要展开日志或设置页。

4. 执行 **AI Worklog: Create Bug**。填写标题“`userName 未定义导致 Hello World 无法运行`”，严重程度选择与实际 UI 中可用的中等或高优先级一致；创建后在侧边栏确认它成为当前 Bug。
5. 将 `std::cout << greet(userName) << std::endl;` 改为 `std::cout << greet("World") << std::endl;` 并保存。
6. 执行 `g++ hello.cpp -o hello.exe`，再执行 `.\hello.exe`，确认输出 `Hello, World!`。

   **[截图点 2：修复验证]** 同时展示修复后的单行代码、成功终端输出、当前任务和 Bug；此时不要关闭侧边栏。

7. 通过 **AI Worklog: Resolve Bug** 按真实提示填写解决摘要，例如“将未定义标识符替换为明确的问候对象，并通过 C++ 编译和运行验证”。
8. 执行 **AI Worklog: Add Note**，输入：

   `C++ 出现“标识符未声明”错误时，应优先检查变量是否在使用前声明、变量名是否拼写一致，以及变量作用域是否正确。`

9. 执行 **AI Worklog: End Task**，等待任务结束与事件写入完成。

   **[截图点 3：已完成任务]** 记录完成状态、Bug 已解决和工作过程摘要。不要在此时录制或截图任何内部 UUID、日志路径或数据目录。

10. 执行 **AI Worklog: Preview AI Context**，从列表选择刚完成的任务；检查预览只包含本 Demo 的脱敏记录。点击面板中的 Ready 操作。

   **[截图点 4：Context Ready]** 仅在 Context 内容无敏感信息时截图；若不适合呈现，可跳过，改拍下一步的总结审核页。

11. 在已配置且可用的 Chat Provider 下执行 **AI Worklog: Generate AI Summary Draft**。选择刚完成的任务和 Ready Context，在确认对话框中确认生成；等待生成完成后会打开 **AI 总结审核**。
12. 查看结构化内容中的任务总结、代码变更、命令结果、Bug 解决方案和知识候选。需要修改时在表单中保存为新的 Revision，再对该 Revision 执行批准。

   **[截图点 5：AI 总结审核]** 展开任务总结、代码变更、命令结果、Bug 解决方案；折叠 Evidence Ref 与内部标识。

13. 在已批准 Revision 的审核页点击 **导出任务总结**，使用 Save Dialog 保存到 Demo 文件夹下的 `exports` 子目录（由用户在保存时创建/选择）。

   **[截图点 6：已批准与导出]** 展示审核页 Approved 状态或历史任务列表；不要把保存对话框中的个人最近路径纳入截图。

14. 仍在审核页，点击 **发布知识候选**。仅当候选内容真实、准确且无敏感信息时，选择与本 Demo 有关的一条，按 UI 逐项确认标题、分类、摘要和可复用说明后发布。
15. 在侧边栏点击 **搜索知识**（或执行 **AI Worklog: Search Knowledge Base**），查询 `标识符未声明` 或 `C++ 未声明变量`。

   **[截图点 7：本地知识检索]** 展示真实搜索结果和知识标题；不要展示 managed knowledge 的本机路径。

16. 可选加分项：若 Chat 与 Embedding 配置已经稳定，执行 **AI Worklog: 问知识库**，提问“`C++ 标识符未声明时应该检查什么？`”。仅当回答引用刚发布的知识时保留截图。

   **[截图点 8：RAG 引用，可选]** 展示回答与引用标题，不展示 Provider 配置或密钥。

## 停止条件

- Provider、网络或生成失败时，不要伪造 Summary、Revision、Published Knowledge 或 RAG；保留前半段真实任务 Demo，并记录实际失败信息。
- 出现安装、后端启动、任务、Bug、Context、审核、导出或发布的真实产品阻塞问题时停止并报告，不自行扩大修复范围。
