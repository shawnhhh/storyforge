# 2026-10-27 现状审计

main: `1a6895f3c69c932b131554e380de6b5cd4d54a41`。通过远端git fetch和GitHub API双重核对。所有来源PR未合并，不修改源分支。

| PR | head SHA | base | 状态 | 最新PR CI |
|---|---|---|---|---|
| #19 | 42aa114e5c6bf824d796c6d0fa2281618802ce16 | main | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/39179571745) |
| #20 | 249ba3a53ef8aa381be867c372a74eb6eab9c28d | main | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/39229671028) |
| #21 | df3599116eba47e0883ad2d5a02953c5a6520f22 | main | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/39577710234) |
| #22 | 173108fb0cdd77028074786aa243fac9a993aa0d | main | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/40280433710) |
| #23 | 9166ffc02529dc9f9357243086706805f7f1b47b | main | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/40297316977) |
| #24 | 5fc17182858be0df98351e7fa906f121cf469c04 | integration/formal-pr19-pr20-pr21-20261026 | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/40335383307) |
| #25 | 45b40769deec00c39726b81875a7b18376cc40c0 | fix/webkit-draft-sqlite-20261026 | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/40343061680) |
| #26 | 12bb9f29f355d9bc401c0589724c087331300522 | fix/webkit-draft-sqlite-20261026 | open / Draft | [success](https://github.com/shawnhhh/storyforge/actions/runs/40344002162) |

#23 集成 #19/#20/#21；#24 基于 #23；#25/#26 分别基于 #24，互不依赖。小说候选从 #25 合入 #26，无代码冲突，保留完整祖先。#22仅历史验证参考，不重复集成。#23–#26最新CI各9/9 jobs成功；矩阵不适用步骤skipped不计测试执行。

现有架构为React/Vite/Tiptap前端，Express本机服务与Node24 SQLite后端，共享DTO、Provider/预算、草稿保护与语义主题。现有小说CRUD、人物世界观、规划时间线、回收站、SQLite迁移备份、AI写作/审阅/规划与提示词均复用，不另建一套。

本轮建立独立Story集成、Shared、Music、Video worktree。后两者依赖Shared，Shared依赖集成候选，PR采用堆叠比较以保持审查范围。不同工作线不共享可写工作区，不修改main、来源PR或任何现有远端分支。
