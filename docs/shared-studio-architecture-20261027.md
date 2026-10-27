# StoryForge 三模块共享基础设施

小说保留原 novels / story-bible / planning / AI / drafts 架构，已有功能不再复制。Music 与 Video 采用独立业务 UI、共用平台无关 DTO、StudioClient、项目版本、素材与生成任务存储及 CreativeProvider 接口。HTTP 与 SQLite 为当前适配器；未来原生客户端可复用合同并替换传输、文件和媒体播放适配器。共享 StudioFrame 使用现有语义主题变量与系统字体，避免绑定桌面框架。

## 数据边界

新增 `studio.sqlite` 与小说数据库位于同一 dataDir，但使用独立 schema、事务和启动迁移。绝不向现有小说 schema 添加表，避免破坏小说备份精确结构校验。**现有小说完整备份不包含 Studio 数据**；项目导出接口 `/api/studio/projects/:id/export` 包含完整内容、所有历史版本、任务与 base64 素材，供用户下载保留。本 MVP 尚无项目导入和跨数据库原子备份。暂停服务后应一并保留两个 SQLite 及其 WAL；不可把小说备份描述为全工作台备份。

Studio 不提供删除接口。保存必须携带当前 version，版本和项目更新在同一事务；历史不可覆盖。素材全部存于 SQLite BLOB，不把用户名称当磁盘路径；单文件最大650KB，API JSON上限1MB，拒绝 HTML/SVG和未知格式。素材返回 nosniff、sandbox CSP，前端按媒体类型预览。API沿用本机Host/Origin、JSON及服务 generation 防护；所有数据访问参数化查询。

## AI 与任务

仅启用明确标记的 MockCreativeProvider，无远程 fetch、API Key、计费调用。音乐输出两秒有效WAV，视频输出一秒有效WebM（本地ffmpeg生成固定fixture）。Provider接口可由未来真实适配器实现，但当前没有真实Provider接入入口。生成绑定请求版本，项目单任务并发，queued / running / completed / failed持久化；重启将未完成任务标为failed。结果与completed状态同事务写入，失败不会伪记成功。MVP进度为模拟值，不代表真实供应商进度。提示词与当时项目快照送入适配器。

合同与API：`shared/contracts/studio.ts`、`src/shared/studio/client.ts`；独立UI通过 `/api/studio/projects`、`/:id/history`、`/:id/assets`、`/:id/generate`、`/:id/tasks`、`/:id/export` 共用基础设施。Music服务端验证速度20–300、曲风/情绪、歌曲结构；Video验证比例、分镜JSON、唯一镜头ID、时长1–60秒及镜头描述/运镜。每项目最多100镜头。

## 验收

仅使用临时目录和隔离SQLite、内置Mock媒体，无.env或真实用户数据访问。新增测试覆盖版本冲突与历史、SQLite重开/完整性、跨模块列表隔离、非法配置原子拒绝、素材MIME/大小/ID、完整导出、生成队列与并发/旧版本拒绝、媒体文件头与重启任务失败恢复。具体测试数量由最终PR验收记录给出；Music/Video各自负责浏览器闭环。

未改main、原始PR分支，未合并PR。独立Draft用于审阅，不宣称跨平台原生设备或真实AI质量已验收。

## Story适配器与共享程度

`creativeModules` 显式注册Story/Music/Video；`ProjectSummary` 与 `/api/studio/catalog` 通过注入已有 NovelStore 聚合三模块项目目录。Story写操作继续委托原小说API，绝不建立第二套小说存储。项目目录、DTO、任务合同、Provider接口、提示词常量与主题组件可复用；Story现有AI预算、复杂上下文和草稿协议仍是原业务实现，尚未迁移为三模块通用执行引擎。Music/Video当前使用新的Mock适配器，不宣称现有真实AI预算已覆盖新的业务。
