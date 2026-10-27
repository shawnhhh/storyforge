# 工程导入 CI 后续修复（来源分支保持冻结）

来源 #32 head e6d4891cb2947d021313909280b719cae9e05a0f。
Push https://github.com/shawnhhh/storyforge/actions/runs/40470753601/job/122077027026 ：40 passed、2 failed。已实际读取日志：

1. studio-import.spec.ts:33 等待“新建视频项目”超时：第一次拒绝离开 Music 的 hashchange 尚未回退完成，测试已继续放弃编辑并第二次赋相同 hash；后续导航可能没有产生新事件。
2. video.spec.ts:126 dialog.accept already handled，与 #31 Push 的失败相同，#32 没包含 #33 修复。

新分支基于 #32，顺序 cherry-pick #33 的 81b882fddf3ad46e058d557605c9907590419833、cd848d1553387df27ee01e264e5de2f36c94defd；新增显式等待 URL 回到 #music、放弃编辑按钮消失，Video 取消完成并回到 #video 后才断言。无 sleep，无放宽超时，无删测试。

本轮受影响 Chromium 用例 repeat-each=5：10/10 通过，0 跳过。lint、typecheck 通过。没有重复运行来源已有成功的完整测试；代码变化后以修复分支新 CI 为准。
