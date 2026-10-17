import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * 生成 PDF 冒烟测试用的样本：8 页 A4，含中文正文、表格、代码、公式和两张 canvas 图。
 * 用 Electron 自带的 printToPDF，得到的是真实 PDF（字体子集嵌入），不是拼出来的假文件。
 *
 * 用法：node scripts/make-test-pdf.mjs
 * 产物：.smoke-data/pdf-src/PDF渲染测试.pdf（可用 READER_TEST_PDF_OUT 指定到别处）
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT =
  process.env.READER_TEST_PDF_OUT ||
  path.join(projectRoot, '.smoke-data', 'pdf-src', 'PDF渲染测试.pdf');
const HTML_FILE = OUTPUT.replace(/\.pdf$/i, '.html');

const ESSAY = [
  '窗外的雨从傍晚一直下到深夜，屋檐下积起一道细长的水线。他把台灯往桌角挪了挪，翻开那本已经卷了边的旧书，纸页发出干脆的响声。',
  '书里讲的是一座靠海的小城：码头、旧钟楼、冬天里仍旧开门的书店，还有一位每天傍晚沿着防波堤散步的老人。',
  '读到第三页的时候，他忽然想起自己也有过这样一段日子。那时候住的地方离海不远，夜里能听见潮水拍岸，风里带着咸味。',
  '文字的意义大概就在这里：它并不替你经历，却能让你在某个毫无准备的瞬间，认出自己曾经的生活。',
  '他合上书，喝了一口已经凉掉的茶。茶面上浮着一层淡淡的光，像很多年前那个夏天，海面上被夕阳拉长的波纹。',
].join('\n');

function paragraphs(count) {
  return Array.from({ length: count }, (_, index) => `<p>${ESSAY}</p>`).join('\n');
}

function table() {
  const rows = [
    ['项目', '参数', '说明'],
    ['页面尺寸', 'A4 210 × 297 mm', '按 CSS @page 输出'],
    ['正文字号', '10.5 pt', '宋体 / 微软雅黑'],
    ['行距', '1.7', '中文长文排版'],
    ['图片', 'canvas 位图', '验证图片解码'],
    ['表格', '斑马纹', '验证边框与底色'],
    ['页数', '8 页', '验证翻页与页码'],
  ];
  return `<table>${rows
    .map(
      (row, index) =>
        `<tr class="${index === 0 ? 'head' : index % 2 === 0 ? 'even' : ''}">${row
          .map((cell) => `<td>${cell}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</table>`;
}

function page(number, title, body) {
  return `<section class="page">
    <header class="page-head"><span>PDF 渲染测试</span><span>第 ${number} 页 / 共 8 页</span></header>
    <h2>${title}</h2>
    ${body}
    <footer class="page-foot">TXT 阅读器 · v11.2 PDF 冒烟样本 · ${number}</footer>
  </section>`;
}

function buildHtml() {
  const pages = [];
  pages.push(`<section class="page cover">
    <p class="kicker">TXT 阅读器 · PDF 一页一屏</p>
    <h1>PDF 渲染测试样本</h1>
    <p class="subtitle">中文排版 / 位图 / 表格 / 长文 / 多页翻页</p>
    <canvas id="cover-chart" width="1400" height="640"></canvas>
    <p class="note">本文件由 scripts/make-test-pdf.mjs 生成，用于冒烟测试：页码递增、每页像素非空、退出重进恢复页码、老板模式仍可渲染。</p>
  </section>`);

  pages.push(
    page(
      2,
      '这一版做了什么',
      `<ol class="feature-list">
        <li>导入 PDF 后原样保存，不抽文字，排版与插图保持原书样式。</li>
        <li>一页一屏：整页按比例放进窗口，不裁切、不横向滚动。</li>
        <li>翻页支持方向键、空格、PageUp/PageDown、滚轮和点击上下半屏。</li>
        <li>进度按页码记录，关掉再打开还停在同一页。</li>
        <li>书签记页码，点击直接跳回。</li>
        <li>老板模式、Esc 返回等快捷键与 TXT/EPUB 完全一致。</li>
      </ol>
      ${paragraphs(1)}`,
    ),
  );

  pages.push(
    page(
      3,
      '参数与容量',
      `${table()}
      <p>表格用来验证 PDF 里的边框、斑马纹和文字对齐。技术类 PDF 常常整页都是这种结构，抽成纯文本会丢掉列与行的关系，按页渲染则不会。</p>
      ${paragraphs(1)}`,
    ),
  );

  pages.push(
    page(
      4,
      '代码与公式',
      `<pre class="code">interface ReadingPosition {
  /** TXT/EPUB：全书字符偏移；PDF：页码（0 基） */
  offset?: number;
}

function pdfPercent(page: number, pageCount: number): number {
  return (clampPage(page, pageCount) + 1) / pageCount;
}</pre>
      <p class="formula">P(读到第 n 页) = (n + 1) / N　（N 为总页数）</p>
      ${paragraphs(1)}`,
    ),
  );

  pages.push(
    page(
      5,
      '整页图与图表',
      `<canvas id="bar-chart" class="full-chart" width="1400" height="820"></canvas>
      <p class="caption">图 1：位图渲染测试。翻到这一页时画布必须非空，缩到老板模式小窗后也要能看清。</p>`,
    ),
  );

  pages.push(
    page(
      6,
      '双栏排版',
      `<div class="columns">${paragraphs(3)}</div>
      <p>双栏是检验「一页一屏」的好样本：页面内容宽度固定，缩放时整页等比变化，栏宽不会被窗口拉变形。</p>`,
    ),
  );

  pages.push(
    page(
      7,
      '长文页',
      `${paragraphs(3)}
      <blockquote>一本书真正被读完的标志，不是翻到最后一页，而是某天你忽然想起里面的某一句话。</blockquote>
      <p>这一页用来确认长文本在 canvas 上渲染清晰，翻页后没有空白、没有半页残留。</p>`,
    ),
  );

  pages.push(
    page(
      8,
      '最后一页',
      `<div class="end-mark">到此结束</div>
      <p class="end-text">如果你在阅读器里看到这一页，说明 8 页样本已经完整翻过一遍：页码递增、每页有内容、进度可恢复。可以按 Esc 返回书架。</p>
      ${paragraphs(1)}`,
    ),
  );

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>PDF 渲染测试</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f1c19; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
  .page {
    width: 210mm; height: 297mm; padding: 20mm 19mm 16mm; overflow: hidden;
    page-break-after: always; position: relative; background: #fff;
  }
  .page:last-child { page-break-after: auto; }
  .cover { display: flex; flex-direction: column; justify-content: center; padding: 30mm 22mm; background: #fbf7ef; }
  .kicker { margin: 0 0 6mm; color: #8a5a2b; font-size: 11pt; letter-spacing: 2px; }
  h1 { margin: 0 0 4mm; font-size: 30pt; letter-spacing: 1px; }
  .subtitle { margin: 0 0 10mm; color: #6f6458; font-size: 13pt; }
  .cover canvas { width: 100%; height: auto; border: 1px solid #d9cbb6; border-radius: 3px; background: #fff; }
  .note { margin-top: 8mm; color: #6f6458; font-size: 9.5pt; line-height: 1.7; }
  h2 { margin: 0 0 6mm; font-size: 18pt; border-bottom: 1.5px solid #c9b79c; padding-bottom: 3mm; }
  p { margin: 0 0 4mm; font-size: 10.5pt; line-height: 1.75; text-align: justify; }
  .page-head { display: flex; justify-content: space-between; color: #9a8d7d; font-size: 8.5pt; margin-bottom: 8mm; }
  .page-foot { position: absolute; left: 19mm; right: 19mm; bottom: 8mm; color: #a99d8c; font-size: 8pt; text-align: center; }
  .feature-list { margin: 0 0 5mm; padding-left: 6mm; }
  .feature-list li { font-size: 10.5pt; line-height: 1.9; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 5mm; font-size: 9.5pt; }
  td { border: 1px solid #cbbca7; padding: 2.2mm 3mm; }
  tr.head td { background: #efe4d3; font-weight: 700; }
  tr.even td { background: #f8f3ea; }
  pre.code { margin: 0 0 5mm; padding: 4mm 5mm; background: #f5f1e9; border-left: 3px solid #b98a55; font-family: "Consolas", monospace; font-size: 9pt; line-height: 1.6; white-space: pre-wrap; }
  .formula { text-align: center; font-size: 11pt; color: #6d4a28; }
  .full-chart { width: 100%; height: auto; border: 1px solid #ded2c0; border-radius: 3px; }
  .caption { margin-top: 3mm; color: #7d7164; font-size: 8.5pt; text-align: center; }
  .columns { column-count: 2; column-gap: 8mm; }
  .columns p { font-size: 9.5pt; line-height: 1.7; }
  blockquote { margin: 2mm 0 5mm; padding: 3mm 5mm; border-left: 3px solid #b98a55; background: #faf6ef; color: #4a4038; font-size: 10pt; line-height: 1.8; }
  .end-mark { margin: 30mm 0 8mm; text-align: center; font-size: 24pt; letter-spacing: 8px; color: #8a5a2b; }
  .end-text { text-align: center; color: #6f6458; }
</style></head><body>
${pages.join('\n')}
<script>
  function paintCover() {
    const canvas = document.getElementById('cover-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#f6ead8');
    gradient.addColorStop(1, '#e6d2b4');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(70, canvas.height - 130, canvas.width - 140, 3);
    const values = [120, 260, 410, 300, 480, 360, 520, 440, 300, 240];
    values.forEach((value, index) => {
      const width = (canvas.width - 180) / values.length;
      const x = 90 + index * width;
      const height = value * 0.8;
      ctx.fillStyle = index % 2 === 0 ? '#a9764a' : '#c79968';
      ctx.fillRect(x, canvas.height - 140 - height, width - 12, height);
    });
    ctx.fillStyle = '#4a4038';
    ctx.font = 'bold 44px "Microsoft YaHei", sans-serif';
    ctx.fillText('PDF · 一页一屏', 80, 100);
    ctx.font = '26px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#6f6458';
    ctx.fillText('中文正文 · 表格 · 代码 · 位图 · 长文', 84, 150);
  }

  function paintBars() {
    const canvas = document.getElementById('bar-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#e3d7c5';
    ctx.lineWidth = 2;
    for (let y = 80; y < canvas.height - 80; y += 110) {
      ctx.beginPath();
      ctx.moveTo(90, y);
      ctx.lineTo(canvas.width - 60, y);
      ctx.stroke();
    }
    const points = [0.22, 0.46, 0.38, 0.62, 0.55, 0.78, 0.7, 0.9];
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = 110 + index * ((canvas.width - 180) / (points.length - 1));
      const y = canvas.height - 120 - point * (canvas.height - 240);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#a9764a';
    ctx.lineWidth = 6;
    ctx.stroke();
    points.forEach((point, index) => {
      const x = 110 + index * ((canvas.width - 180) / (points.length - 1));
      const y = canvas.height - 120 - point * (canvas.height - 240);
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#8a5a2b';
      ctx.fill();
    });
    ctx.fillStyle = '#4a4038';
    ctx.font = 'bold 40px "Microsoft YaHei", sans-serif';
    ctx.fillText('阅读进度示意', 90, 70);
    ctx.font = '26px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#7d7164';
    ctx.fillText('每页渲染完成后，画布上应有足够多的非白色像素', 92, canvas.height - 40);
  }

  paintCover();
  paintBars();
</script>
</body></html>`;
}

const html = buildHtml();

app.whenReady().then(async () => {
  try {
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(HTML_FILE, html, 'utf8');
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 1600,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await win.loadFile(HTML_FILE);
    // 等字体与 canvas 都画完（字体未就绪时中文会按回退字体排版）
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await new Promise((resolve) => setTimeout(resolve, 900));
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await fs.writeFile(OUTPUT, pdf);
    console.log(`PDF_OK ${OUTPUT} ${(pdf.length / 1024).toFixed(1)} KB`);
    app.exit(0);
  } catch (error) {
    console.error('生成测试 PDF 失败：', error);
    app.exit(1);
  }
});
