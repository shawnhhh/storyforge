# 业务模块

`novels/` 包含工作台、按需加载的 Tiptap 编辑器、HTTP 客户端、串行自动保存队列及界面样式。正式数据经 Express 写入 SQLite，不使用 localStorage / IndexedDB。

后续按领域组织 characters、worlds 等模块；组件、请求及测试按模块就近维护。模块通过公开入口协作，不跨模块引用内部文件。自动保存队列测试当前位于 `server/tests/autosave.test.ts`，由统一 Node 测试命令运行。
