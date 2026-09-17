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

- 问题优先级为 `high` / `medium` / `low`，新增时缺省为 `medium`；历史问题缺少优先级同样按 `medium` 处理。
- 区段存在未解决的高优先级问题时，`PATCH /sections/:id/check` 标记已校对会被拒绝（409），中、低优先级问题不影响校对。
- 已校对区段新增（或重新打开）高优先级问题后自动回退为未校对，曲目进度随已校对区段数同步下降。
- 区段最后一个高优先级问题解决后只解除阻止，不会自动标记已校对，仍需人工确认。
- 区段查询（`GET /tunes/:id/sections`、`GET /tunes/:id/unchecked-sections`）为每个区段附带：
  - `openIssueCount`：未解决问题总数（含低优先级）
  - `openHighPriorityCount`：未解决高优先级问题数
  - `blocked`：是否被高优先级问题阻止校对

## 闭环示例

```bash
curl http://127.0.0.1:3019/tunes/tune_demo/progress
curl -X POST http://127.0.0.1:3019/issues \
  -H 'Content-Type: application/json' \
  -d '{"tuneId":"tune_demo","sectionId":"section_demo_2","type":"错孔","beat":45,"lane":9,"priority":"high","description":"第45拍第9轨多打孔"}'
curl -X PATCH http://127.0.0.1:3019/sections/section_demo_2/check \
  -H 'Content-Type: application/json' -d '{"checked":true}'
# => 409 区段还有 1 个未解决的高优先级问题，无法标记为已校对
```
