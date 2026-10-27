# PR #31 真实 CI 失败修复

基线 a4d2408b113e57978809d454d587dae6d6b72520。
失败证据：https://github.com/shawnhhh/storyforge/actions/runs/40468060905/job/122068169499
Chromium 3/3：42 通过、1 失败；video.spec.ts:126 报 dialog.accept: Cannot accept dialog which is already handled。
测试在 hashchange 确认对话框真正取消完成之前就注册刷新对话框处理器，两个处理器可能作用于同一对话框。
修复显式等待 confirm dismiss 完成，并断言 URL 已回到 #video，再触发刷新。
未删测试、未放宽超时。临时 SQLite + Mock，Chromium 同一草稿用例 repeat-each=5：5 通过、0 失败。
该修复不代表 #31 已全绿；原 push 失败记录保留。macOS 工作流仍需完成。
