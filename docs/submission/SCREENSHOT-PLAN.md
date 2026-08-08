# Phase 1 Screenshot Plan

正式截图由用户人工截取，建议使用 `materials/screenshots/` 中的文件名。共 7 张必选，RAG 为 1 张可选。

| # | 建议文件名 | 功能与操作路径 | 截图前状态 / 建议画面 | 证明点 / 隐私检查 |
|---|---|---|---|---|
| 1 | `01-current-task-and-error.png` | 开始任务后执行 `g++ hello.cpp -o hello.exe` | 编辑器、终端编译错误与 AI Worklog 侧栏同屏 | 自动关联真实任务与开发错误；不含个人路径或日志 |
| 2 | `02-bug-and-fix-verified.png` | 创建 Bug、修复、编译并运行 | 修复行、`Hello, World!`、侧栏当前 Bug | Bug 生命周期覆盖真实修复；隐藏无关终端历史 |
| 3 | `03-task-completed.png` | Resolve Bug、Add Note、End Task | 侧栏展开已完成任务与已解决 Bug | 过程记录由用户显式控制；不要显示数据目录 |
| 4 | `04-context-ready.png` | Preview AI Context 后标记 Ready | Context Webview 展开少量业务摘要 | AI 外发前先进行脱敏、预览与确认；无敏感内容才拍 |
| 5 | `05-summary-review-revision.png` | Generate Summary Draft，必要时保存 Revision | AI 总结审核页的任务总结/代码变更/命令/Bug 解决方案 | 结构化 AI 输出且可人工修订；折叠 Evidence / ID |
| 6 | `06-approved-and-export.png` | 批准 Revision 后导出任务总结 | Approved 状态或历史任务与总结页面 | 人工审核后才允许正式导出；不拍文件保存对话框 |
| 7 | `07-published-knowledge-search.png` | 发布真实候选后搜索 `标识符未声明` | 知识搜索结果及标题 | 审核后的内容进入本地可检索知识；不显示本机路径 |
| 8（可选） | `08-rag-answer-citation.png` | 问知识库并获得真实引用 | 回答与引用标题 | Published Knowledge 可被带引用复用；仅在真实成功时拍 |

拍摄原则：窗口最大化，保留产品标题与关键结果，避免配置页、密钥、Output 日志、UUID、绝对路径和无关的个人文件标签。第 4 或第 8 张不适合时可以省略，最终保持 6–8 张即可。
