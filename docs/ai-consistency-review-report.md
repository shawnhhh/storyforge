# AI 章节一致性审阅开发与测试报告

开发分支：`feat/ai-consistency-review-20261019`，基线 `1a6895f`（main 已合并的 PR #18）。独立交付，不修改 main、PR #19、PR #13/#15 原分支。

已完成只读审阅弹窗、显式引用、实际消息预览与确认指纹、结构化依据检查与不确定建议、现有 Provider/模型/预算/并发复用，以及专项 API/浏览器测试。没有新增依赖或数据库迁移。

本地验证：lint、typecheck、build 及纯单元测试；详细结果在 CI 完成后记录。当前云端沙箱拒绝监听 127.0.0.1（EPERM），本地 API/E2E 未完成；确认无残留测试进程后停止重试，交由 GitHub Actions 验证。没有删除测试或放宽断言。

GitHub Actions：Linux 执行静态检查、build、完整单元/API、重复草稿恢复和写作回归、完整 Chromium E2E；macOS 真 Chrome 通道和 WebKit 执行原有重复队列测试、写作回归及一致性审阅专项。结果待运行后更新。WebKit 自动化不等同于真实 Safari 手工验收。

验收步骤见 [功能说明](ai-consistency-review.md)。所有测试使用虚构数据、临时数据库和 Mock，没有读取真实小说数据库、备份或 `.env`，没有调用付费 AI。
