/**
 * 左格（zuoge）融资路演 BP — 生成脚本
 * 数值类字段标【待填】，勿当作已发生事实对外宣称。
 */
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "左格-BP-融资路演.pptx");

// Palette: ink studio + warm gold (design tool, not generic SaaS purple)
const C = {
  ink: "0B1220",
  inkSoft: "141C2B",
  gold: "C9A227",
  goldSoft: "E8D5A3",
  cream: "F7F5F0",
  white: "FFFFFF",
  text: "0F172A",
  muted: "64748B",
  line: "E2E8F0",
  card: "FFFFFF",
  danger: "B45309",
};

function addFooter(slide, page, total, dark = false) {
  slide.addText("左格 · Confidential", {
    x: 0.5,
    y: 5.28,
    w: 6,
    h: 0.28,
    fontSize: 10,
    fontFace: "Microsoft YaHei",
    color: dark ? "64748B" : C.muted,
    margin: 0,
  });
  slide.addText(`${page} / ${total}`, {
    x: 8.2,
    y: 5.28,
    w: 1.3,
    h: 0.28,
    fontSize: 10,
    fontFace: "Microsoft YaHei",
    color: dark ? "64748B" : C.muted,
    align: "right",
    margin: 0,
  });
}

function sectionLabel(slide, text, y = 0.35) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5,
    y: y + 0.08,
    w: 0.12,
    h: 0.28,
    fill: { color: C.gold },
    line: { color: C.gold },
  });
  slide.addText(text, {
    x: 0.75,
    y: y,
    w: 8,
    h: 0.4,
    fontSize: 12,
    fontFace: "Microsoft YaHei",
    color: C.gold,
    bold: true,
    charSpacing: 2,
    margin: 0,
  });
}

const TOTAL = 13;
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "左格团队";
pres.title = "左格 zuoge — 融资路演 BP";
pres.subject = "AI 设计 Agent · 开源工作台";

// —— 1 封面 ——
{
  const s = pres.addSlide();
  s.background = { color: C.ink };
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 5.625,
    fill: { color: C.gold },
    line: { color: C.gold },
  });
  s.addText("SEED / PRE-A  ·  融资路演", {
    x: 0.7,
    y: 1.35,
    w: 8.5,
    h: 0.35,
    fontSize: 13,
    fontFace: "Arial",
    color: C.gold,
    charSpacing: 3,
    margin: 0,
  });
  s.addText("左格", {
    x: 0.7,
    y: 1.85,
    w: 8.5,
    h: 0.85,
    fontSize: 54,
    fontFace: "Microsoft YaHei",
    color: C.white,
    bold: true,
    margin: 0,
  });
  s.addText("懂你的设计 Agent", {
    x: 0.7,
    y: 2.7,
    w: 8.5,
    h: 0.45,
    fontSize: 22,
    fontFace: "Microsoft YaHei",
    color: C.goldSoft,
    margin: 0,
  });
  s.addText(
    "开源 AI 设计工作台：对话驱动无限画布 · Design Agent · 可自托管",
    {
      x: 0.7,
      y: 3.35,
      w: 8.2,
      h: 0.4,
      fontSize: 14,
      fontFace: "Microsoft YaHei",
      color: "94A3B8",
      margin: 0,
    }
  );
  s.addText("recombyn.com  ·  github.com/recombyn/zuoge", {
    x: 0.7,
    y: 4.85,
    w: 8,
    h: 0.3,
    fontSize: 12,
    fontFace: "Arial",
    color: "64748B",
    margin: 0,
  });
}

// —— 2 一句话 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "VISION");
  s.addText("一句话", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.5,
    fontSize: 28,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 1.6,
    w: 9,
    h: 2.4,
    fill: { color: C.ink },
    rectRadius: 0.08,
  });
  s.addText(
    "把「设计交付」从工具操作，升级为可对话、可协作、可落地的 Agent 工作台——结果直接可编辑，而不是一张不可改的图。",
    {
      x: 0.85,
      y: 2.05,
      w: 8.3,
      h: 1.5,
      fontSize: 20,
      fontFace: "Microsoft YaHei",
      color: C.white,
      margin: 0,
      valign: "middle",
    }
  );
  s.addText("做个，设计从未如此简单。", {
    x: 0.5,
    y: 4.3,
    w: 9,
    h: 0.4,
    fontSize: 16,
    fontFace: "Microsoft YaHei",
    color: C.muted,
    italic: true,
    margin: 0,
  });
  addFooter(s, 2, TOTAL);
}

// —— 3 痛点 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "PROBLEM");
  s.addText("设计协作仍卡在「工具孤岛」", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.45,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  const pains = [
    {
      t: "生成不可编辑",
      d: "多数 AI 出图是位图终点；改稿仍要重回传统设计软件手工重做。",
    },
    {
      t: "Agent 与画布割裂",
      d: "聊天框与设计文件两套系统，无法在同一场景上规划、落笔、迭代。",
    },
    {
      t: "企业数据不敢上云",
      d: "品牌资产与客户稿件敏感；需要可自托管、可审计的本地化路径。",
    },
    {
      t: "生态难扩展",
      d: "技能、模型、外部 IDE（如 Cursor）无法用同一合约读写同一项目。",
    },
  ];
  pains.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 4.6;
    const y = 1.55 + row * 1.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 4.35,
      h: 1.4,
      fill: { color: C.white },
      shadow: {
        type: "outer",
        color: "000000",
        blur: 8,
        offset: 2,
        angle: 135,
        opacity: 0.08,
      },
      rectRadius: 0.06,
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 0.1,
      h: 1.4,
      fill: { color: C.gold },
      line: { color: C.gold },
    });
    s.addText(p.t, {
      x: x + 0.3,
      y: y + 0.25,
      w: 3.8,
      h: 0.35,
      fontSize: 16,
      fontFace: "Microsoft YaHei",
      color: C.text,
      bold: true,
      margin: 0,
    });
    s.addText(p.d, {
      x: x + 0.3,
      y: y + 0.65,
      w: 3.8,
      h: 0.55,
      fontSize: 12,
      fontFace: "Microsoft YaHei",
      color: C.muted,
      margin: 0,
    });
  });
  addFooter(s, 3, TOTAL);
}

// —— 4 解决方案 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "SOLUTION");
  s.addText("左格：画布即 Agent 的执行现场", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.45,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  const pillars = [
    { n: "01", t: "无限矢量画布", d: "SceneDocument · SVG 节点\n可缩放、可编辑、可导出" },
    { n: "02", t: "Design Agent", d: "LangGraph 内核固定\n对话 → Skill → tool_ops 落笔" },
    { n: "03", t: "开放合约", d: "MCP 读写同一项目\n插件 / Skills 可扩展" },
    { n: "04", t: "可部署形态", d: "Web · Tauri 桌面\nDocker 自托管全栈" },
  ];
  pillars.forEach((p, i) => {
    const x = 0.5 + i * 2.35;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.55,
      w: 2.2,
      h: 3.15,
      fill: { color: i === 1 ? C.ink : C.white },
      rectRadius: 0.06,
      shadow:
        i === 1
          ? undefined
          : {
              type: "outer",
              color: "000000",
              blur: 8,
              offset: 2,
              angle: 135,
              opacity: 0.08,
            },
    });
    s.addText(p.n, {
      x: x + 0.15,
      y: 1.75,
      w: 1.9,
      h: 0.35,
      fontSize: 14,
      fontFace: "Arial",
      color: C.gold,
      bold: true,
      margin: 0,
    });
    s.addText(p.t, {
      x: x + 0.15,
      y: 2.25,
      w: 1.9,
      h: 0.7,
      fontSize: 16,
      fontFace: "Microsoft YaHei",
      color: i === 1 ? C.white : C.text,
      bold: true,
      margin: 0,
    });
    s.addText(p.d, {
      x: x + 0.15,
      y: 3.15,
      w: 1.9,
      h: 1.2,
      fontSize: 12,
      fontFace: "Microsoft YaHei",
      color: i === 1 ? "94A3B8" : C.muted,
      margin: 0,
    });
  });
  addFooter(s, 4, TOTAL);
}

// —— 5 产品 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "PRODUCT");
  s.addText("核心能力一览", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  const rows = [
    ["能力", "说明"],
    ["对话生成可编辑设计", "海报 / 移动界面 / 网站结构 / 图片，直接落在画布节点"],
    ["实时协作", "Yjs 多端同编，团队共创同一场景"],
    ["MCP 画布", "Cursor 等外部工具与内置 Agent 共用 tool_ops 合约"],
    ["插件生态", "Skill 包 + 画布插件，可打包分发"],
    ["开源 + 商业双轨", "OSS 自托管底座；Intelligence 等增值能力可商业化"],
  ];
  s.addTable(
    rows.map((r, i) =>
      r.map((cell) => ({
        text: cell,
        options: {
          fill: { color: i === 0 ? C.ink : i % 2 === 0 ? "F1EFEA" : C.white },
          color: i === 0 ? C.white : C.text,
          bold: i === 0 || r[0] === cell,
          fontFace: "Microsoft YaHei",
          fontSize: i === 0 ? 12 : 13,
          align: "left",
          valign: "middle",
        },
      }))
    ),
    {
      x: 0.5,
      y: 1.45,
      w: 9,
      h: 3.4,
      colW: [2.8, 6.2],
      border: { pt: 0, color: C.cream },
    }
  );
  addFooter(s, 5, TOTAL);
}

// —— 6 市场 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "MARKET");
  s.addText("市场机会", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });
  s.addText(
    "创意生产正从「工具订阅」转向「Agent 工作流」——可编辑、可协作、可私有化是决策关键。",
    {
      x: 0.5,
      y: 1.35,
      w: 9,
      h: 0.55,
      fontSize: 14,
      fontFace: "Microsoft YaHei",
      color: C.muted,
      margin: 0,
    }
  );

  const mk = [
    { k: "TAM", v: "【待填】", d: "全球设计 / 营销创作软件与\nAI 创意工具总盘" },
    { k: "SAM", v: "【待填】", d: "中小团队 + 企业品牌设计\n可触达的 Agent 工作台市场" },
    { k: "SOM", v: "【待填】", d: "未来 24 个月可服务的\n订阅 / 私有化收入目标" },
  ];
  mk.forEach((m, i) => {
    const x = 0.5 + i * 3.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 2.15,
      w: 2.95,
      h: 2.5,
      fill: { color: C.white },
      rectRadius: 0.06,
      shadow: {
        type: "outer",
        color: "000000",
        blur: 8,
        offset: 2,
        angle: 135,
        opacity: 0.08,
      },
    });
    s.addText(m.k, {
      x: x + 0.2,
      y: 2.4,
      w: 2.55,
      h: 0.3,
      fontSize: 12,
      fontFace: "Arial",
      color: C.gold,
      bold: true,
      margin: 0,
    });
    s.addText(m.v, {
      x: x + 0.2,
      y: 2.85,
      w: 2.55,
      h: 0.55,
      fontSize: 22,
      fontFace: "Microsoft YaHei",
      color: C.text,
      bold: true,
      margin: 0,
    });
    s.addText(m.d, {
      x: x + 0.2,
      y: 3.55,
      w: 2.55,
      h: 0.85,
      fontSize: 12,
      fontFace: "Microsoft YaHei",
      color: C.muted,
      margin: 0,
    });
  });
  addFooter(s, 6, TOTAL);
}

// —— 7 竞争 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "COMPETITION");
  s.addText("我们如何不同", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  const table = [
    [
      { text: "维度", options: { bold: true } },
      { text: "纯出图 AI", options: { bold: true } },
      { text: "传统设计工具", options: { bold: true } },
      { text: "左格", options: { bold: true } },
    ],
    ["可编辑矢量结果", "弱", "强", "强"],
    ["画布内 Agent", "弱 / 无", "弱", "强"],
    ["开源可自托管", "少", "少", "是"],
    ["MCP / 外部 IDE", "少", "少", "是"],
    ["实时协作", "参差", "强", "有"],
  ];

  s.addTable(
    table.map((row, ri) =>
      row.map((cell, ci) => {
        const raw = typeof cell === "string" ? cell : cell.text;
        const isHeader = ri === 0;
        const isZuoge = ci === 3 && !isHeader;
        return {
          text: raw,
          options: {
            fill: {
              color: isHeader ? C.ink : isZuoge ? "F5EED8" : ri % 2 ? "F1EFEA" : C.white,
            },
            color: isHeader ? C.white : isZuoge ? C.text : C.text,
            bold: isHeader || isZuoge || (typeof cell !== "string" && cell.options?.bold),
            fontFace: "Microsoft YaHei",
            fontSize: 12,
            align: "center",
            valign: "middle",
          },
        };
      })
    ),
    {
      x: 0.5,
      y: 1.45,
      w: 9,
      h: 3.3,
      colW: [2.4, 2.2, 2.2, 2.2],
      border: { pt: 0, color: C.cream },
    }
  );
  addFooter(s, 7, TOTAL);
}

// —— 8 商业模式 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "BUSINESS MODEL");
  s.addText("商业化路径", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  const models = [
    {
      t: "云端订阅",
      d: "个人 / 团队席位\nAgent 额度 · 协作空间\n官网 recombyn.com",
    },
    {
      t: "企业私有化",
      d: "自托管部署与支持\n品牌隔离 · SSO / 审计\n合同年费 + 实施",
    },
    {
      t: "Intelligence 增值",
      d: "高阶视觉智能能力\n（闭源模块）\n与开源内核解耦售卖",
    },
  ];
  models.forEach((m, i) => {
    const x = 0.5 + i * 3.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.5,
      w: 2.95,
      h: 2.9,
      fill: { color: i === 0 ? C.ink : C.white },
      rectRadius: 0.06,
      shadow:
        i === 0
          ? undefined
          : {
              type: "outer",
              color: "000000",
              blur: 8,
              offset: 2,
              angle: 135,
              opacity: 0.08,
            },
    });
    s.addText(`0${i + 1}`, {
      x: x + 0.25,
      y: 1.75,
      w: 2.4,
      h: 0.3,
      fontSize: 12,
      fontFace: "Arial",
      color: C.gold,
      bold: true,
      margin: 0,
    });
    s.addText(m.t, {
      x: x + 0.25,
      y: 2.2,
      w: 2.4,
      h: 0.45,
      fontSize: 18,
      fontFace: "Microsoft YaHei",
      color: i === 0 ? C.white : C.text,
      bold: true,
      margin: 0,
    });
    s.addText(m.d, {
      x: x + 0.25,
      y: 2.85,
      w: 2.4,
      h: 1.3,
      fontSize: 13,
      fontFace: "Microsoft YaHei",
      color: i === 0 ? "94A3B8" : C.muted,
      margin: 0,
    });
  });
  addFooter(s, 8, TOTAL);
}

// —— 9 壁垒 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "MOAT");
  s.addText("技术与产品壁垒", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  const moats = [
    {
      t: "统一场景模型",
      d: "SceneDocument + tool_ops：Agent、MCP、协作写同一真相源，避免「聊天与文件两张皮」。",
    },
    {
      t: "可配置 Agent 内核",
      d: "LangGraph 固定管线 + Profile / Skills / 工具注册表——行为可产品化、可评测、可迭代。",
    },
    {
      t: "开源飞轮",
      d: "社区插件与自托管降低获客成本；商业 Intelligence 吃高价值工作负载。",
    },
    {
      t: "评测与工程化",
      d: "Design Agent eval / harness 体系，把「感觉好」变成可回归的质量基线。",
    },
  ];
  moats.forEach((m, i) => {
    const y = 1.4 + i * 0.85;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5,
      y,
      w: 9,
      h: 0.75,
      fill: { color: C.white },
      rectRadius: 0.05,
    });
    s.addShape(pres.shapes.OVAL, {
      x: 0.7,
      y: y + 0.2,
      w: 0.35,
      h: 0.35,
      fill: { color: C.gold },
    });
    s.addText(String(i + 1), {
      x: 0.7,
      y: y + 0.22,
      w: 0.35,
      h: 0.32,
      fontSize: 11,
      fontFace: "Arial",
      color: C.ink,
      bold: true,
      align: "center",
      margin: 0,
    });
    s.addText(m.t, {
      x: 1.25,
      y: y + 0.12,
      w: 2.4,
      h: 0.5,
      fontSize: 14,
      fontFace: "Microsoft YaHei",
      color: C.text,
      bold: true,
      valign: "middle",
      margin: 0,
    });
    s.addText(m.d, {
      x: 3.7,
      y: y + 0.12,
      w: 5.5,
      h: 0.5,
      fontSize: 12,
      fontFace: "Microsoft YaHei",
      color: C.muted,
      valign: "middle",
      margin: 0,
    });
  });
  addFooter(s, 9, TOTAL);
}

// —— 10 牵引 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "TRACTION");
  s.addText("进展与牵引（请填真实数据）", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 24,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  const kpis = [
    { l: "注册 / 活跃", v: "【待填】" },
    { l: "付费转化", v: "【待填】" },
    { l: "ARR / MRR", v: "【待填】" },
    { l: "开源 Star / Fork", v: "【待填】" },
    { l: "企业 POC", v: "【待填】" },
    { l: "NPS / 留存", v: "【待填】" },
  ];
  kpis.forEach((k, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.5 + col * 3.1;
    const y = 1.5 + row * 1.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 2.95,
      h: 1.35,
      fill: { color: C.ink },
      rectRadius: 0.06,
    });
    s.addText(k.v, {
      x: x + 0.2,
      y: y + 0.3,
      w: 2.55,
      h: 0.5,
      fontSize: 20,
      fontFace: "Microsoft YaHei",
      color: C.goldSoft,
      bold: true,
      margin: 0,
    });
    s.addText(k.l, {
      x: x + 0.2,
      y: y + 0.85,
      w: 2.55,
      h: 0.3,
      fontSize: 13,
      fontFace: "Microsoft YaHei",
      color: "94A3B8",
      margin: 0,
    });
  });
  addFooter(s, 10, TOTAL);
}

// —— 11 团队 + 路线 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "TEAM & ROADMAP");
  s.addText("团队与路线图", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 1.4,
    w: 4.35,
    h: 3.35,
    fill: { color: C.white },
    rectRadius: 0.06,
    shadow: {
      type: "outer",
      color: "000000",
      blur: 8,
      offset: 2,
      angle: 135,
      opacity: 0.08,
    },
  });
  s.addText("核心团队", {
    x: 0.75,
    y: 1.6,
    w: 3.8,
    h: 0.35,
    fontSize: 16,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });
  s.addText(
    [
      { text: "创始人 / CEO — 【姓名·背景】", options: { bullet: true, breakLine: true } },
      { text: "技术负责人 — 【姓名·背景】", options: { bullet: true, breakLine: true } },
      { text: "产品 / 设计 — 【姓名·背景】", options: { bullet: true, breakLine: true } },
      { text: "顾问 / 天使 — 【待填】", options: { bullet: true } },
    ],
    {
      x: 0.75,
      y: 2.15,
      w: 3.8,
      h: 2.2,
      fontSize: 13,
      fontFace: "Microsoft YaHei",
      color: C.muted,
      margin: 0,
    }
  );

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 5.15,
    y: 1.4,
    w: 4.35,
    h: 3.35,
    fill: { color: C.ink },
    rectRadius: 0.06,
  });
  s.addText("近 18 个月重点", {
    x: 5.4,
    y: 1.6,
    w: 3.8,
    h: 0.35,
    fontSize: 16,
    fontFace: "Microsoft YaHei",
    color: C.white,
    bold: true,
    margin: 0,
  });
  s.addText(
    [
      { text: "H1：产品体验打磨 · 付费闭环", options: { bullet: true, breakLine: true } },
      { text: "H2：企业私有化与标杆客户", options: { bullet: true, breakLine: true } },
      { text: "H3：插件生态与 MCP 开发者", options: { bullet: true, breakLine: true } },
      { text: "持续：Agent 质量评测与模型路由", options: { bullet: true } },
    ],
    {
      x: 5.4,
      y: 2.15,
      w: 3.8,
      h: 2.2,
      fontSize: 13,
      fontFace: "Microsoft YaHei",
      color: "CBD5E1",
      margin: 0,
    }
  );
  addFooter(s, 11, TOTAL);
}

// —— 12 融资 ——
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  sectionLabel(s, "THE ASK");
  s.addText("本轮融资", {
    x: 0.5,
    y: 0.85,
    w: 9,
    h: 0.4,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5,
    y: 1.45,
    w: 4.35,
    h: 3.2,
    fill: { color: C.ink },
    rectRadius: 0.08,
  });
  s.addText("融资金额", {
    x: 0.8,
    y: 1.8,
    w: 3.8,
    h: 0.3,
    fontSize: 13,
    fontFace: "Microsoft YaHei",
    color: "94A3B8",
    margin: 0,
  });
  s.addText("【待填】万人民币", {
    x: 0.8,
    y: 2.25,
    w: 3.8,
    h: 0.55,
    fontSize: 26,
    fontFace: "Microsoft YaHei",
    color: C.goldSoft,
    bold: true,
    margin: 0,
  });
  s.addText("轮次  【天使 / Pre-A】\n估值  【待填】\n出让  【待填】%", {
    x: 0.8,
    y: 3.1,
    w: 3.8,
    h: 1.1,
    fontSize: 14,
    fontFace: "Microsoft YaHei",
    color: "CBD5E1",
    margin: 0,
  });

  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 5.15,
    y: 1.45,
    w: 4.35,
    h: 3.2,
    fill: { color: C.white },
    rectRadius: 0.08,
    shadow: {
      type: "outer",
      color: "000000",
      blur: 8,
      offset: 2,
      angle: 135,
      opacity: 0.08,
    },
  });
  s.addText("资金用途", {
    x: 5.45,
    y: 1.7,
    w: 3.8,
    h: 0.35,
    fontSize: 16,
    fontFace: "Microsoft YaHei",
    color: C.text,
    bold: true,
    margin: 0,
  });
  s.addText(
    [
      { text: "产品与 Agent 质量 — 【%】", options: { bullet: true, breakLine: true } },
      { text: "增长与品牌 — 【%】", options: { bullet: true, breakLine: true } },
      { text: "企业销售与交付 — 【%】", options: { bullet: true, breakLine: true } },
      { text: "算力与基础设施 — 【%】", options: { bullet: true, breakLine: true } },
      { text: "团队扩充 — 【%】", options: { bullet: true } },
    ],
    {
      x: 5.45,
      y: 2.25,
      w: 3.8,
      h: 2.1,
      fontSize: 14,
      fontFace: "Microsoft YaHei",
      color: C.muted,
      margin: 0,
    }
  );
  addFooter(s, 12, TOTAL);
}

// —— 13 结尾 ——
{
  const s = pres.addSlide();
  s.background = { color: C.ink };
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 5.625,
    fill: { color: C.gold },
    line: { color: C.gold },
  });
  s.addText("一起把设计做成 Agent 原生体验", {
    x: 0.7,
    y: 1.7,
    w: 8.5,
    h: 0.7,
    fontSize: 28,
    fontFace: "Microsoft YaHei",
    color: C.white,
    bold: true,
    margin: 0,
  });
  s.addText("左格 · zuoge", {
    x: 0.7,
    y: 2.55,
    w: 8.5,
    h: 0.4,
    fontSize: 18,
    fontFace: "Microsoft YaHei",
    color: C.gold,
    margin: 0,
  });
  s.addText(
    "官网  recombyn.com\n文档  recombyn.github.io/recombyn\n开源  github.com/recombyn/zuoge\n联系  【邮箱 / 微信】",
    {
      x: 0.7,
      y: 3.3,
      w: 8,
      h: 1.4,
      fontSize: 14,
      fontFace: "Microsoft YaHei",
      color: "94A3B8",
      margin: 0,
    }
  );
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await pres.writeFile({ fileName: OUT });
  console.log("Wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
