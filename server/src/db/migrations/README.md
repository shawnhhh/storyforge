# 数据库迁移

`0001_novels.sql` 新增 novels、chapters 与章节排序索引。`migrate.ts` 在 `BEGIN IMMEDIATE` 事务中执行，使用 `schema_migrations` 记录已完成的版本；重复启动不重复执行，失败回滚并停止启动，不自动删除已有表或数据。遇到同名旧表时应编写显式兼容迁移，不直接重建数据库。

`0002_story_bible.sql` 只新增 characters、world_entries、character_relations、character_world_links 与索引，不更新 novels 或 chapters 的记录。人物扩展字段使用 JSON 对象，标签使用 JSON 数组；SQL CHECK、复合外键与 API 校验共同约束结构。人物关系两端及世界观关联两端必须属于同一本小说，目标删除后级联清理关联。API 删除目标时还会更新受影响人物的版本，阻止旧表单覆盖。

迁移脚本只增不改：后续结构变化新增 `0005_*.sql`，并在迁移执行器中注册。修改已应用的脚本不会更新用户数据库。数据库结构版本、实体并发版本、正文内容格式版本分别管理。迁移执行器只接受连续且受支持的版本序列；失败回滚整个迁移事务。

备份支持 v1/v2/v3/v4 的完整 schema 签名。恢复旧版本时只迁移临时副本到 v4，原备份的内容及校验和不变。恢复前先创建当前完整 v4 安全备份，再在一个事务中恢复全部应用表；旧快照缺少的资料或写作记录初始化为空，写作目标使用默认值，不会降级活动数据库结构。

第五阶段不占用数字版本：`planning_001.sql` 由独立 `planning-migrate.ts` 在基础迁移后执行，用 `planning_migrations` 记录 `planning/001`。模块迁移失败回滚并停止启动。备份严格支持基础 v1/v2/v3/v4 × 无 planning/planning v1 八种签名；恢复私有副本先升级基础版本，再运行规划迁移。详见 [规划说明](../../../../docs/plot-planning.md)。

`0003_writing_dashboard.sql` 仅新增每日增量记录 `writing_days` 与每日目标 `writing_settings`。迁移不回填旧内容为历史活动，不修改小说、章节或规划。两个表均纳入完整备份和原子恢复。

`0004_knowledge.sql` 为资料库基础迁移：在工作台 v3 后应用，保留独立关联版本和删除失效触发器，不重写小说或正文。
