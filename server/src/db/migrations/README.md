# 数据库迁移

`0001_novels.sql` 新增 novels、chapters 与章节排序索引。`migrate.ts` 在 `BEGIN IMMEDIATE` 事务中执行，使用 `schema_migrations` 记录已完成的版本；重复启动不重复执行，失败回滚并停止启动，不自动删除已有表或数据。遇到同名旧表时应编写显式兼容迁移，不直接重建数据库。

`0002_story_bible.sql` 只新增 characters、world_entries、character_relations、character_world_links 与索引，不更新 novels 或 chapters 的记录。人物扩展字段使用 JSON 对象，标签使用 JSON 数组；SQL CHECK、复合外键与 API 校验共同约束结构。人物关系两端及世界观关联两端必须属于同一本小说，目标删除后级联清理关联。API 删除目标时还会更新受影响人物的版本，阻止旧表单覆盖。

迁移脚本只增不改：后续结构变化新增 `0003_*.sql`，并在迁移执行器中注册。修改已应用的脚本不会更新用户数据库。数据库结构版本、实体并发版本、正文内容格式版本分别管理。迁移执行器只接受连续且受支持的版本序列；失败回滚整个迁移事务。

备份支持原始 v1 与当前 v2 的完整 schema 签名。恢复 v1 时只迁移临时副本到 v2，原备份的内容及校验和不变。恢复前先创建当前完整 v2 安全备份，再在一个事务中恢复全部应用表；恢复后的 v1 快照具有空人物/世界观资料库，不会降级活动数据库结构。

第五阶段不占用数字版本：`planning_001.sql` 由独立 `planning-migrate.ts` 在基础迁移后执行，用 `planning_migrations` 记录 `planning/001`。模块迁移失败回滚并停止启动。备份严格支持基础 v1/v2 × 无 planning/planning v1 四种签名；恢复私有副本先升级基础版本，再运行规划迁移。详见 [规划说明](../../../../docs/plot-planning.md)。
