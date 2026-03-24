# TODO: GA 前合并 Migration

## 背景

当前 `server/src/storage/db.ts` 中有 57 个增量 migration（001 ~ 057），包含大量开发过程中的 ALTER、RENAME、FIX 补丁。GA 时用户拿到的是全新数据库，不需要这些中间迁移。

## 目标

将所有 migration 合并为一个 `001_initial_schema`，只包含最终的完整建表语句。

## 执行步骤

### 1. 导出当前最终 schema

```bash
# 起一个临时空数据库，跑完所有 migration，导出最终 DDL
MY_CLAUDIA_DATA_DIR=$(mktemp -d) node -e "
  const { initDatabase } = require('./server/dist/storage/db.js');
  const db = initDatabase();
  const tables = db.prepare(\"SELECT sql FROM sqlite_master WHERE type='table' AND name != 'migrations' ORDER BY name\").all();
  const indexes = db.prepare(\"SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name\").all();
  tables.forEach(t => console.log(t.sql + ';'));
  indexes.forEach(i => console.log(i.sql + ';'));
  db.close();
"
```

### 2. 替换 migration 数组

在 `server/src/storage/db.ts` 的 `runMigrations()` 中：
- 删除所有 57 个 migration entry
- 替换为一个 `001_initial_schema`，包含步骤 1 导出的完整 DDL
- 保留 `migrations` 表本身的创建逻辑（migration 机制仍然需要）

### 3. 检查运行时 migration 逻辑

部分 migration 包含运行时回调（如 `reindexAllMessages`），需确认：
- 全新数据库是否需要这些操作（大概率不需要，因为没有旧数据）
- 如果需要，作为 post-init hook 而非 migration

### 4. 验证

```bash
# 删除旧数据库，用新 schema 启动
rm ~/.my-claudia/data.db
pnpm server:dev
# 验证所有功能正常
```

### 5. 清理开发环境

通知所有开发者删除本地 `data.db` 重建。

## 注意事项

- migration name `001_initial_schema` 与旧的不同，所以旧数据库升级会失败——这是预期行为（GA = 全新安装）
- GA 后的新 schema 变更继续用增量 migration（从 `002_` 开始）
- 如果需要支持 beta 用户升级到 GA，需要额外的迁移路径（但目前不需要考虑）
