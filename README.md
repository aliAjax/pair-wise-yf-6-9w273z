# 手摇风琴纸带打孔API

纯后端零依赖Node服务，使用 `data/db.json` 持久化曲目、纸带区间和试奏问题。

## 启动

```bash
PORT=3019 node server.js
```

## 主要接口

- `GET /health`
- `GET /tunes`
- `POST /tunes`
- `GET /tunes/:id/progress`
- `GET /tunes/:id/sections`
- `POST /tunes/:id/sections`
- `GET /tunes/:id/unchecked-sections`
- `PATCH /sections/:id/check`
- `GET /issues?tuneId=&status=&priority=`
- `POST /issues`
- `PATCH /issues/:id/status`

## 问题复核闭环

问题优先级为 `high` / `medium` / `low`：

- 新增问题默认 `medium`；历史问题缺少优先级或值非法时一律按 `medium` 处理。
- 区段存在未解决的 **high** 问题时，`PATCH /sections/:id/check` 返回 409，无法校对。
- 已校对区段新增（或重开）高优先级问题后，区段自动回退为未校对，曲目进度同步下降。
- 区段最后一个高优先级问题解决后只解除阻止，区段仍保持未校对，需人工再次确认。
- `low` 问题不影响校对；`medium` 同样不阻止校对，但区段查询始终返回未解决问题数量。

区段查询（含 `unchecked-sections`）每条记录附带：

```json
{
  "openIssues": 2,
  "openHighIssues": 1,
  "resolvedIssues": 0,
  "blockedByHighIssue": true
}
```

进度接口额外提供 `openHighIssues`。

## 闭环示例

```bash
curl http://127.0.0.1:3019/tunes/tune_demo/progress
curl -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo","sectionId":"section_demo_2","priority":"high","type":"错孔","beat":45,"lane":9,"description":"第45拍第9轨多打孔"}'
# 高优先级问题解决后仍需人工 PATCH /sections/:id/check 才恢复已校对
```
