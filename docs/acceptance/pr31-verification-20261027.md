# PR #31 集成基线核验

PR https://github.com/shawnhhh/storyforge/pull/31 当前 Draft，head a4d2408b113e57978809d454d587dae6d6b72520，与输入一致。没有修改来源分支、main 或合并任何 PR。

获取 head_sha 对应全部 Actions：REST actions/runs?head_sha=...&per_page=100 共2条，无后续页；不是只查询 PR 事件。

| 验证项 | push 40468060905 | PR 40468150712 |
|---|---|---|
| lint / typecheck / build / 单元API | 成功 | 成功 |
| Chromium 1/3、2/3 | 成功 | 成功 |
| Chromium 3/3 | **失败**（42 passed，1 failed） | 成功 |
| Firefox 1/3、2/3、3/3 | 成功 | 成功 |
| macOS Chrome | 成功 | 成功 |
| macOS Playwright WebKit | 成功 | 运行中（最后核验时） |

工作流：https://github.com/shawnhhh/storyforge/actions/runs/40468060905 与 https://github.com/shawnhhh/storyforge/actions/runs/40468150712 。完整 job/step 结果存于同目录 pr31-actions-*.json。条件跳过的 step 保持 skipped，不能视为执行成功；WebKit 不等于真实 Safari。

真实失败日志已读取：push job 122068169499，video.spec.ts:126，dialog.accept: Cannot accept dialog which is already handled。修复在独立 #33，等待取消确认与 hash 回退完成后再注册刷新 dialog，Chromium 连跑5次成功。原失败不被后续 PR 成功掩盖。

导航：700/390px 小说首页→音乐/视频→小说本地通过；未保存 Music 阻止切走、Video 取消离开保留正文，本地通过。额外复核发现小说正文/资料/规划未保存时缺少 App hash 切换保护，在 #33 独立补丁新增阻止事件。保存失败后尝试切 Music/Video 用例通过。没有把 #31 本身描述成已包含补丁或整体验收通过。

本轮功能：#32 工程导入；统一备份单独 Draft PR。各分支必须以本 head CI 验收，来源通过不自动传递。
