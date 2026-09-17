const http = require("http");
const { readFile, writeFile, mkdir } = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3019);
const DB_FILE = path.join(__dirname, "data", "db.json");

const PRIORITIES = ["high", "medium", "low"];

// 新增问题默认中优先级；历史问题缺少优先级（或值非法）也按中处理
function issuePriority(issue) {
  return PRIORITIES.includes(issue.priority) ? issue.priority : "medium";
}

function isOpenIssue(issue) {
  return issue.status !== "resolved";
}

const initialData = {
  tunes: [
    {
      id: "tune_demo",
      title: "雨后圆舞曲",
      composer: "匿名",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 82,
        paperType: "半透明纸带"
      },
      createdAt: new Date().toISOString()
    }
  ],
  sections: [
    {
      id: "section_demo_1",
      tuneId: "tune_demo",
      startBeat: 1,
      endBeat: 32,
      laneRange: "1-10",
      checked: true,
      note: "开头主题已试奏"
    },
    {
      id: "section_demo_2",
      tuneId: "tune_demo",
      startBeat: 33,
      endBeat: 64,
      laneRange: "4-18",
      checked: false,
      note: "副歌段等待校对"
    }
  ],
  issues: [
    {
      id: "issue_demo",
      tuneId: "tune_demo",
      sectionId: "section_demo_2",
      type: "漏孔",
      beat: 41,
      lane: 12,
      description: "第41拍高音孔漏打",
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null
    }
  ]
};

const routes = [
  "GET /health",
  "GET /tunes",
  "POST /tunes",
  "GET /tunes/:id/progress",
  "GET /tunes/:id/sections",
  "POST /tunes/:id/sections",
  "GET /tunes/:id/unchecked-sections",
  "PATCH /sections/:id/check",
  "GET /issues",
  "POST /issues",
  "PATCH /issues/:id/status"
];

async function ensureDb() {
  await mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    JSON.parse(await readFile(DB_FILE, "utf8"));
  } catch {
    await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(DB_FILE, "utf8"));
}

async function writeDb(data) {
  await writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function parseUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return { pathname: url.pathname, searchParams: url.searchParams };
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体必须是合法JSON");
    error.status = 400;
    throw error;
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) {
    const error = new Error(`缺少字段：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function findTune(db, tuneId) {
  const tune = db.tunes.find((item) => item.id === tuneId);
  if (!tune) {
    const error = new Error("曲目不存在");
    error.status = 404;
    throw error;
  }
  return tune;
}

function sectionIssueStats(db, sectionId) {
  const issues = db.issues.filter((item) => item.sectionId === sectionId);
  const open = issues.filter(isOpenIssue);
  const openHigh = open.filter((item) => issuePriority(item) === "high").length;
  return {
    openIssues: open.length,
    openHighIssues: openHigh,
    resolvedIssues: issues.length - open.length,
    blockedByHighIssue: openHigh > 0
  };
}

// 区段查询需附带未解决问题数量（低优先级也计入）
function decorateSection(db, section) {
  return { ...section, ...sectionIssueStats(db, section.id) };
}

// 存在未解决高优先级问题的区段不允许保持“已校对”
function applyHighIssueGate(db, section) {
  if (!section) return false;
  const stats = sectionIssueStats(db, section.id);
  if (section.checked && stats.blockedByHighIssue) {
    section.checked = false;
    return true;
  }
  return false;
}

function buildProgress(db, tuneId) {
  findTune(db, tuneId);
  const sections = db.sections.filter((item) => item.tuneId === tuneId);
  const issues = db.issues.filter((item) => item.tuneId === tuneId);
  const checkedCount = sections.filter((item) => item.checked).length;
  const openIssues = issues.filter(isOpenIssue).length;
  const openHighIssues = issues.filter((item) => isOpenIssue(item) && issuePriority(item) === "high").length;
  return {
    tuneId,
    totalSections: sections.length,
    checkedSections: checkedCount,
    uncheckedSections: sections.length - checkedCount,
    openIssues,
    openHighIssues,
    resolvedIssues: issues.length - openIssues,
    percent: sections.length ? Math.round((checkedCount / sections.length) * 100) : 0
  };
}

async function handle(req, res) {
  const { pathname, searchParams } = parseUrl(req);
  const db = await readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "organ-strip-punch-api", routes });
  }

  if (req.method === "GET" && pathname === "/tunes") {
    const tunes = db.tunes.map((tune) => ({ ...tune, progress: buildProgress(db, tune.id) }));
    return send(res, 200, { data: tunes });
  }

  if (req.method === "POST" && pathname === "/tunes") {
    const body = await parseBody(req);
    required(body, ["title", "stripSpec"]);
    const tune = {
      id: makeId("tune"),
      title: body.title,
      composer: body.composer || "",
      stripSpec: body.stripSpec,
      createdAt: new Date().toISOString()
    };
    db.tunes.push(tune);
    await writeDb(db);
    return send(res, 201, { data: tune });
  }

  const tuneSectionsMatch = pathname.match(/^\/tunes\/([^/]+)\/sections$/);
  if (tuneSectionsMatch && req.method === "GET") {
    const tuneId = tuneSectionsMatch[1];
    findTune(db, tuneId);
    const data = db.sections
      .filter((item) => item.tuneId === tuneId)
      .map((section) => decorateSection(db, section));
    return send(res, 200, { data });
  }

  if (tuneSectionsMatch && req.method === "POST") {
    const tuneId = tuneSectionsMatch[1];
    findTune(db, tuneId);
    const body = await parseBody(req);
    required(body, ["startBeat", "endBeat", "laneRange"]);
    const section = {
      id: makeId("section"),
      tuneId,
      startBeat: Number(body.startBeat),
      endBeat: Number(body.endBeat),
      laneRange: body.laneRange,
      checked: Boolean(body.checked),
      note: body.note || ""
    };
    db.sections.push(section);
    await writeDb(db);
    return send(res, 201, { data: decorateSection(db, section) });
  }

  const uncheckedMatch = pathname.match(/^\/tunes\/([^/]+)\/unchecked-sections$/);
  if (uncheckedMatch && req.method === "GET") {
    const tuneId = uncheckedMatch[1];
    findTune(db, tuneId);
    const data = db.sections
      .filter((item) => item.tuneId === tuneId && !item.checked)
      .map((section) => decorateSection(db, section));
    return send(res, 200, { data });
  }

  const progressMatch = pathname.match(/^\/tunes\/([^/]+)\/progress$/);
  if (progressMatch && req.method === "GET") {
    return send(res, 200, { data: buildProgress(db, progressMatch[1]) });
  }

  const checkMatch = pathname.match(/^\/sections\/([^/]+)\/check$/);
  if (checkMatch && req.method === "PATCH") {
    const section = db.sections.find((item) => item.id === checkMatch[1]);
    if (!section) return send(res, 404, { error: "区间不存在" });
    const body = await parseBody(req);
    const nextChecked = body.checked !== undefined ? Boolean(body.checked) : true;
    // 未解决的高优先级问题会阻止区段校对；撤销校对不受限
    if (nextChecked && sectionIssueStats(db, section.id).blockedByHighIssue) {
      return send(res, 409, {
        error: "该区段仍有未解决的高优先级问题，无法校对",
        data: decorateSection(db, section)
      });
    }
    section.checked = nextChecked;
    section.note = body.note ?? section.note;
    await writeDb(db);
    return send(res, 200, { data: decorateSection(db, section) });
  }

  if (req.method === "GET" && pathname === "/issues") {
    const tuneId = searchParams.get("tuneId");
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const issues = db.issues
      .filter(
        (item) =>
          (!tuneId || item.tuneId === tuneId) &&
          (!status || item.status === status) &&
          (!priority || issuePriority(item) === priority)
      )
      .map((issue) => ({ ...issue, priority: issuePriority(issue) }));
    return send(res, 200, { data: issues });
  }

  if (req.method === "POST" && pathname === "/issues") {
    const body = await parseBody(req);
    required(body, ["tuneId", "sectionId", "type", "description"]);
    findTune(db, body.tuneId);
    const section = db.sections.find((item) => item.id === body.sectionId && item.tuneId === body.tuneId);
    if (!section) return send(res, 400, { error: "区间不存在或不属于该曲目" });
    const priority = body.priority === undefined ? "medium" : body.priority;
    if (!PRIORITIES.includes(priority)) {
      return send(res, 400, { error: `优先级非法，可选：${PRIORITIES.join(", ")}` });
    }
    const issue = {
      id: makeId("issue"),
      tuneId: body.tuneId,
      sectionId: body.sectionId,
      type: body.type,
      beat: body.beat === undefined ? null : Number(body.beat),
      lane: body.lane === undefined ? null : Number(body.lane),
      description: body.description,
      priority,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null
    };
    db.issues.push(issue);
    // 已校对区段新增高优先级问题后回退为未校对，曲目进度随之下跌
    const reverted = applyHighIssueGate(db, section);
    await writeDb(db);
    return send(res, 201, {
      data: issue,
      section: decorateSection(db, section),
      revertedChecked: reverted
    });
  }

  const issueStatusMatch = pathname.match(/^\/issues\/([^/]+)\/status$/);
  if (issueStatusMatch && req.method === "PATCH") {
    const issue = db.issues.find((item) => item.id === issueStatusMatch[1]);
    if (!issue) return send(res, 404, { error: "问题不存在" });
    const body = await parseBody(req);
    required(body, ["status"]);
    issue.status = body.status;
    issue.resolvedAt = body.status === "resolved" ? new Date().toISOString() : null;
    issue.note = body.note ?? issue.note;
    // 历史问题缺少优先级时按中处理，可在此显式补录
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority)) {
        return send(res, 400, { error: `优先级非法，可选：${PRIORITIES.join(", ")}` });
      }
      issue.priority = body.priority;
    } else {
      issue.priority = issuePriority(issue);
    }
    const section = db.sections.find((item) => item.id === issue.sectionId) || null;
    // 重新打开高优先级问题同样回退校对；解决最后一个高优先级问题只解除阻止，不自动校对
    const reverted = applyHighIssueGate(db, section);
    await writeDb(db);
    return send(res, 200, {
      data: issue,
      section: section ? decorateSection(db, section) : null,
      revertedChecked: reverted
    });
  }

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Organ strip punch API running at http://127.0.0.1:${PORT}`);
});
