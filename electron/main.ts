import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, app, desktopCapturer, dialog, globalShortcut, ipcMain, screen } from 'electron';
import type { OpenDialogOptions } from 'electron';
import type { Book, Prefs, Progress } from '../src/shared/types';
import { pickWritableDir } from '../src/core/datadir';
import { resolveNoSandbox } from '../src/core/platform';
import { summarize } from '../src/core/stats';
import {
  BOSS_OPACITY_DEFAULT,
  clampOpacity,
  normalizeBounds,
  safeBossBounds,
  sameSize,
} from '../src/core/window';
import type { Rect } from '../src/core/window';
import { LibraryStore, normalizeHotkey } from '../src/main/store';
import {
  importBookBytes,
  importBookFile,
  loadBookContent,
  readPdfBytes,
  removeBookContent,
} from '../src/main/library';

const SMOKE_TEST = process.argv.includes('--smoke-test');

/**
 * Windows 11 25H2（Build 26200+）上 Electron 的 GPU 沙箱会崩（exit_code=-2147483645），
 * 而且崩溃发生在主进程 JS 执行之前，所以程序内部无法自救——
 * 必须由启动方带上 --no-sandbox（打包时会生成带参数的快捷方式，见 scripts/package.mjs）。
 * 这里是唯一能做的：在还能跑到 JS 的情况下给出提示。
 */
if (
  resolveNoSandbox(process.platform, os.release(), process.env.READER_NO_SANDBOX) &&
  !process.argv.includes('--no-sandbox')
) {
  console.warn('[reader] 当前 Windows 版本需要以 --no-sandbox 启动，否则会在窗口出现前崩溃。');
}

/**
 * 在 app ready 之前确定数据目录。
 * 顺序：READER_DATA_DIR（显式指定）→ 系统 userData → exe 同级的 data/（便携模式）。
 * 环境不可写时 Chromium 会直接崩，所以必须先探一遍。
 */
function resolveUserDataDir(): void {
  const configured = process.env.READER_DATA_DIR?.trim();
  const candidates = [
    ...(configured ? [path.resolve(configured)] : []),
    app.getPath('userData'),
    path.join(path.dirname(app.getPath('exe')), 'data'),
  ];

  const writable = pickWritableDir(candidates, fs);
  if (!writable) {
    console.warn('[reader] 找不到可写的数据目录，书库可能无法保存。');
    return;
  }
  if (writable !== app.getPath('userData')) {
    console.warn(`[reader] 使用备用数据目录：${writable}`);
    app.setPath('userData', writable);
  }
}

resolveUserDataDir();

let storePromise: Promise<LibraryStore> | null = null;

function libraryBaseDir(): string {
  return path.join(app.getPath('userData'), 'library');
}

function getStore(): Promise<LibraryStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new LibraryStore(libraryBaseDir());
      await store.init();
      return store;
    })();
  }
  return storePromise;
}

/* ---------------- 窗口状态与老板模式 ---------------- */

let storedWindowBounds: Rect | null = null;
let storedBossBounds: Rect | null = null;
let bossOpacityPref = BOSS_OPACITY_DEFAULT;
let bossMode = false;
let bossHotkey = 'Control+Alt+B';
let normalBoundsBeforeBoss: Rect | null = null;
let wasMaximizedBeforeBoss = false;
let wasFullScreenBeforeBoss = false;
let boundsTimer: NodeJS.Timeout | null = null;

async function loadWindowState(): Promise<void> {
  const store = await getStore();
  const ui = store.getUi();
  storedWindowBounds = ui.windowBounds;
  storedBossBounds = ui.bossBounds;
  bossOpacityPref = ui.bossOpacity;
  bossHotkey = ui.bossHotkey;
}

/** 老板模式的整窗透明度（越小越透）。 */
function bossTintValue(): number {
  return clampOpacity(bossOpacityPref);
}

function broadcastBoss(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.webContents.send('boss:changed', {
    boss: bossMode,
    opacity: bossTintValue(),
    hotkey: bossHotkey,
  });
}

/** 普通模式下记住窗口位置，下次打开还原；老板模式的位置单独记。 */
function trackWindowBounds(win: BrowserWindow): void {
  const save = () => {
    if (bossMode || win.isDestroyed()) return;
    const bounds = win.getBounds();
    storedWindowBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      void (async () => {
        const store = await getStore();
        await store.setUi({ windowBounds: storedWindowBounds });
      })();
    }, 500);
  };
  win.on('resize', save);
  win.on('move', save);
}

/**
 * 把窗口缩到左下角小窗，并**校验是否真的生效**。
 *
 * Windows 上刚退出最大化/全屏时，setBounds 可能被忽略 —— 表现就是
 * "只变透明、不缩小"。这里应用后复查，不对就再试，最多 4 次。
 */
function applyBossBounds(win: BrowserWindow, attempt = 0): void {
  if (win.isDestroyed() || !bossMode) return;
  try {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const target = safeBossBounds(area, storedBossBounds);
    win.setBounds(target, true);

    setTimeout(() => {
      if (win.isDestroyed() || !bossMode) return;
      const now = win.getBounds();
      if (sameSize(now, target)) return;
      if (attempt < 4) {
        applyBossBounds(win, attempt + 1);
      } else {
        console.warn('[boss] 窗口尺寸始终未生效', now, target);
      }
    }, 90);
  } catch (error) {
    console.error('[boss] 设置小窗尺寸失败', error);
  }
}

function enterBoss(win: BrowserWindow): void {
  if (bossMode) return;
  try {
    // 全屏/最大化时 setBounds 会被忽略，必须先退出这两个状态
    wasMaximizedBeforeBoss = win.isMaximized();
    wasFullScreenBeforeBoss = win.isFullScreen();
    normalBoundsBeforeBoss = win.getBounds();
    bossMode = true;
    win.setTitle(' ');
    // 最小尺寸是给普通模式设的，小窗要先放宽，否则 setBounds 会被夹回 900
    win.setMinimumSize(320, 200);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setSkipTaskbar(true);
    // 透明窗口必须无边框才生效，而本应用保留系统边框，所以只能用整窗透明度：
    // 桌面能透过来，但文字也会跟着变淡（这是 Windows 上的取舍）
    win.setOpacity(bossTintValue());
    applyBossBounds(win);
    broadcastBoss(win);
  } catch (error) {
    console.error('[boss] 进入老板模式失败', error);
    bossMode = false;
  }
}

async function exitBoss(win: BrowserWindow): Promise<void> {
  if (!bossMode) return;
  try {
    const bossBounds = win.getBounds();
    const restore = normalBoundsBeforeBoss;
    bossMode = false;
    win.setOpacity(1);
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
    win.setTitle('TXT 阅读器');
    win.setMinimumSize(900, 620);
    if (restore) win.setBounds(restore, true);
    // 恢复原来的最大化 / 全屏状态
    if (wasFullScreenBeforeBoss) win.setFullScreen(true);
    else if (wasMaximizedBeforeBoss) win.maximize();
    wasMaximizedBeforeBoss = false;
    wasFullScreenBeforeBoss = false;
    broadcastBoss(win);

    // 小窗位置只在正常退出时记录；尺寸明显异常的（历史 bug 遗留）不写入
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const safe = safeBossBounds(area, bossBounds);
    const store = await getStore();
    await store.setUi({ bossBounds: sameSize(safe, bossBounds) ? bossBounds : null });
  } catch (error) {
    console.error('[boss] 退出老板模式失败', error);
  }
}

function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function bindBossHotkey(accelerator: string): boolean {
  globalShortcut.unregisterAll();
  // 单键热键不注册为全局：否则任何程序的输入框里按这个键都会被打断，
  // 这类热键只在应用窗口获得焦点时由渲染层处理。
  if (!accelerator.includes('+')) return true;
  const handler = () => {
    try {
      const win = activeWindow();
      if (!win) return;
      if (bossMode) void exitBoss(win);
      else enterBoss(win);
    } catch (error) {
      console.error('[boss] 热键处理失败', error);
    }
  };
  try {
    return globalShortcut.register(accelerator, handler);
  } catch {
    return false;
  }
}

function registerGlobalShortcuts(): void {
  // 老板模式：窗口失焦也要能一键切换
  if (!bindBossHotkey(bossHotkey)) {
    console.warn(`[reader] 全局热键 ${bossHotkey} 被占用，只能用界面按钮切换。`);
    // 兜底回默认热键，保证功能可用
    if (bossHotkey !== 'Control+Alt+B' && bindBossHotkey('Control+Alt+B')) {
      bossHotkey = 'Control+Alt+B';
    }
  }
}

function createWindow(): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workArea;
  const fallback: Rect = { x: workArea.x, y: workArea.y, width: 1240, height: 860 };
  const initial = normalizeBounds(storedWindowBounds, workArea, fallback);

  const win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    minWidth: 900,
    minHeight: 620,
    title: 'TXT 阅读器',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: '#f4efe6',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  if (process.env.READER_DEBUG === '1') {
    win.webContents.on('did-finish-load', () => {
      void win.webContents.executeJavaScript('window.__READER_DEBUG__ = true');
    });
  }
  win.once('ready-to-show', () => win.show());
  trackWindowBounds(win);

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void win.loadURL(devServer);
  } else {
    void win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  return win;
}

function registerIpc(): void {
  ipcMain.handle('library:list', async () => {
    const store = await getStore();
    return store.listWithProgress();
  });

  ipcMain.handle('library:import-dialog', async (): Promise<Book[]> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options: OpenDialogOptions = {
      title: '选择电子书',
      filters: [
        { name: '电子书', extensions: ['epub', 'txt', 'pdf'] },
        { name: 'EPUB', extensions: ['epub'] },
        { name: 'TXT', extensions: ['txt'] },
        { name: 'PDF', extensions: ['pdf'] },
      ],
      properties: ['openFile', 'multiSelections'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return [];

    const store = await getStore();
    const baseDir = libraryBaseDir();
    const imported: Book[] = [];
    for (const filePath of result.filePaths) {
      imported.push(await importBookFile(store, baseDir, filePath));
    }
    return imported;
  });

  ipcMain.handle(
    'library:import-bytes',
    async (_event, fileName: string, data: ArrayBuffer, sourcePath: string | null): Promise<Book> => {
      const store = await getStore();
      return importBookBytes(store, libraryBaseDir(), fileName, new Uint8Array(data), sourcePath);
    },
  );

  ipcMain.handle('library:remove', async (_event, id: string): Promise<void> => {
    const store = await getStore();
    await store.remove(id);
    await removeBookContent(libraryBaseDir(), id);
  });

  ipcMain.handle('library:open', async (_event, id: string) => {
    const store = await getStore();
    return loadBookContent(store, libraryBaseDir(), id);
  });

  // PDF：渲染层用 pdf.js 自己解码，主进程只负责把原始字节递过去
  ipcMain.handle('pdf:read', async (_event, id: string): Promise<ArrayBuffer> => {
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('无效的书籍编号');
    const bytes = await readPdfBytes(libraryBaseDir(), id);
    // 复制一份独立的 ArrayBuffer：IPC 会做结构化克隆，不能把 Node Buffer 的池子递过去
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
  });

  ipcMain.handle('pdf:save-page-count', async (_event, id: string, pageCount: number) => {
    if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
    const store = await getStore();
    return store.setPageCount(id, Number(pageCount));
  });

  ipcMain.handle('progress:get', async (_event, bookId: string): Promise<Progress | null> => {
    const store = await getStore();
    return store.getProgress(bookId);
  });

  ipcMain.handle('progress:set', async (_event, progress: Progress): Promise<void> => {
    const store = await getStore();
    await store.setProgress(progress);
  });

  ipcMain.handle('prefs:get', async (): Promise<Prefs> => {
    const store = await getStore();
    return store.getPrefs();
  });

  ipcMain.handle('prefs:set', async (_event, patch: Partial<Prefs>): Promise<Prefs> => {
    const store = await getStore();
    return store.setPrefs(patch);
  });

  ipcMain.handle('window:get-state', () => ({
    boss: bossMode,
    opacity: bossTintValue(),
    hotkey: bossHotkey,
  }));

  ipcMain.handle('image:pick', async (): Promise<string | null> => {
    const win = activeWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('image:data', async (_event, filePath: string): Promise<string | null> => {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      return `data:image/${mime};base64,${buffer.toString('base64')}`;
    } catch (error) {
      console.error('[image] 读取背景图失败', error);
      return null;
    }
  });

  // 书内图片：只允许读取该书 media 目录下的普通文件名，防止路径穿越
  ipcMain.handle('image:book', async (_event, bookId: string, file: string): Promise<string | null> => {
    if (!/^[A-Za-z0-9-]+$/.test(bookId) || !/^[A-Za-z0-9._-]+$/.test(file)) return null;
    try {
      const full = path.join(libraryBaseDir(), 'books', `${bookId}.media`, file);
      const buffer = await fs.promises.readFile(full);
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      return `data:image/${mime};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle('window:set-hotkey', async (_event, value: string): Promise<boolean> => {
    try {
      const next = normalizeHotkey(value);
      const previous = bossHotkey;
      if (!bindBossHotkey(next)) {
        // 注册失败就恢复旧热键，不能让老板模式失去入口
        bindBossHotkey(previous);
        return false;
      }
      bossHotkey = next;
      const store = await getStore();
      await store.setUi({ bossHotkey: next });
      const win = activeWindow();
      if (win) broadcastBoss(win);
      return true;
    } catch (error) {
      console.error('[hotkey] 设置热键失败', error);
      return false;
    }
  });

  ipcMain.handle('window:toggle-boss', async (_event, on?: boolean): Promise<boolean> => {
    const win = activeWindow();
    if (!win) return bossMode;
    const next = typeof on === 'boolean' ? on : !bossMode;
    if (next) enterBoss(win);
    else await exitBoss(win);
    return next;
  });

  ipcMain.handle('window:set-boss-tint', async (_event, value: number): Promise<number> => {
    bossOpacityPref = clampOpacity(Number(value));
    const store = await getStore();
    await store.setUi({ bossOpacity: bossOpacityPref });
    // 不管是否在老板模式，都要把新浓度广播出去，否则设置里的滑块不会动
    const win = activeWindow();
    if (win) broadcastBoss(win);
    return bossOpacityPref;
  });

  ipcMain.handle('bookmarks:list', async (_event, bookId: string) => {
    const store = await getStore();
    return store.getBookmarks(bookId);
  });

  ipcMain.handle(
    'bookmarks:add',
    async (
      _event,
      input: { bookId: string; offset: number; chapterTitle: string; excerpt: string },
    ) => {
      const store = await getStore();
      return store.addBookmark({
        id: randomUUID(),
        bookId: input.bookId,
        offset: Math.max(0, Math.round(input.offset || 0)),
        chapterTitle: input.chapterTitle ?? '',
        excerpt: input.excerpt ?? '',
        createdAt: Date.now(),
      });
    },
  );

  ipcMain.handle('bookmarks:remove', async (_event, bookId: string, id: string) => {
    const store = await getStore();
    await store.removeBookmark(bookId, id);
  });

  ipcMain.handle('stats:summary', async (_event, windowDays?: number) => {
    const store = await getStore();
    return summarize(store.getSessions(), Date.now(), windowDays ?? 7);
  });

  ipcMain.handle(
    'stats:add',
    async (_event, session: { bookId: string; startedAt: number; seconds: number }) => {
      const store = await getStore();
      await store.addSession(session);
    },
  );

  ipcMain.handle('stats:clear', async () => {
    const store = await getStore();
    await store.clearSessions();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------- PDF 冒烟：翻页、像素、书签、老板模式、进度 ---------------- */

interface PdfProbeResult {
  footer: string;
  header: string;
  page: number | null;
  total: number | null;
  canvas: { width: number; height: number; ratio: number } | null;
  loading: boolean;
  error: string | null;
  marks: number;
  boss: boolean;
}

/** 从渲染层读一次 PDF 视图的状态：页码、画布像素占比、加载/错误标记。 */
async function probePdf(win: BrowserWindow): Promise<PdfProbeResult> {
  return win.webContents.executeJavaScript(
    `(() => {
       const footerNode = document.querySelector('[data-testid="reader-footer"]');
       const footer = (footerNode?.textContent || '').replace(/\\s+/g, ' ').trim();
       const header = (document.querySelector('.reader-heading')?.textContent || '')
         .replace(/\\s+/g, ' ').trim();
       const canvas = document.querySelector('.pdf-canvas');
       let stats = null;
       if (canvas && canvas.width > 0 && canvas.height > 0) {
         try {
           const context = canvas.getContext('2d');
           const width = canvas.width;
           const height = canvas.height;
           const data = context.getImageData(0, 0, width, height).data;
           const stepX = Math.max(1, Math.floor(width / 240));
           const stepY = Math.max(1, Math.floor(height / 240));
           let dark = 0;
           let total = 0;
           for (let y = 0; y < height; y += stepY) {
             for (let x = 0; x < width; x += stepX) {
               const index = (y * width + x) * 4;
               const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
               total += 1;
               if (value < 235) dark += 1;
             }
           }
           stats = { width, height, ratio: total > 0 ? dark / total : 0 };
         } catch (error) {
           stats = { width: canvas.width, height: canvas.height, ratio: -1 };
         }
       }
       const parsed = /第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/.exec(footer);
       return {
         footer,
         header,
         page: parsed ? Number(parsed[1]) : null,
         total: parsed ? Number(parsed[2]) : null,
         canvas: stats,
         loading: !!document.querySelector('.pdf-loading'),
         error: (document.querySelector('.pdf-error p')?.textContent || '').trim() || null,
         marks: document.querySelectorAll('.pdf-marks .mark-row').length,
         boss: !!document.querySelector('.reader.boss'),
       };
     })()`,
  ) as Promise<PdfProbeResult>;
}

/** 等 PDF 文档打开并渲染出第一页。 */
async function waitForPdf(win: BrowserWindow, timeoutMs = 45000): Promise<PdfProbeResult> {
  const deadline = Date.now() + timeoutMs;
  let probe = await probePdf(win);
  while (
    Date.now() < deadline &&
    (!probe.total || !probe.canvas || probe.canvas.width === 0 || probe.loading)
  ) {
    await delay(400);
    probe = await probePdf(win);
  }
  return probe;
}

async function pressKey(win: BrowserWindow, key: string): Promise<void> {
  await win.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`,
  );
}

/**
 * PDF 的一页一屏验收：
 * 1. 能打开、页数正确、第一页有像素；
 * 2. 连翻几页：页码 +1 且每页都有内容（不是空白）；
 * 3. 上一页能退回去；
 * 4. 书签记页码、点击跳回；
 * 5. 老板模式里继续渲染；退出重进能恢复页码。
 */
async function runPdfSmoke(win: BrowserWindow, screenshotPath: string): Promise<number> {
  let failures = 0;
  const fail = (label: string, detail: unknown) => {
    failures += 1;
    console.log(`[pdf] FAIL ${label} ${JSON.stringify(detail)}`);
  };

  const first = await waitForPdf(win);
  console.log('[pdf] first ' + JSON.stringify(first));
  if (first.error) fail('open-error', first);
  else if (!first.total || first.total < 2) fail('page-count', first);
  else if (first.page !== 1) fail('first-page-not-1', first);
  if (!first.canvas || first.canvas.width === 0 || first.canvas.ratio < 0.002) {
    fail('blank-first-page', first);
  }

  const steps = Number(process.env.READER_SMOKE_PDF_STEPS) || 4;
  let previous = first.page ?? 0;
  for (let index = 0; index < steps; index += 1) {
    await pressKey(win, 'ArrowDown');
    await delay(700);
    const next = await probePdf(win);
    console.log(
      `[pdf] step ${index + 1} page=${next.page} ratio=${next.canvas ? next.canvas.ratio.toFixed(4) : 'n/a'} loading=${next.loading}`,
    );
    if (!next.page || next.page !== previous + 1) fail('page-step', { previous, next: next.page });
    if (!next.canvas || next.canvas.width === 0 || next.canvas.ratio < 0.002) {
      fail('blank-page', { page: next.page, canvas: next.canvas });
    }
    previous = next.page ?? previous + 1;
  }

  await pressKey(win, 'ArrowUp');
  await delay(700);
  const back = await probePdf(win);
  console.log('[pdf] prev ' + JSON.stringify(back));
  if (back.page !== previous - 1) fail('page-prev', { previous, back: back.page });

  // 点击下半屏、滚轮也要能翻页
  const clickedNext = await win.webContents.executeJavaScript(
    `(() => {
       const view = document.querySelector('[data-testid="pdf-viewer"]');
       if (!view) return false;
       const rect = view.getBoundingClientRect();
       view.dispatchEvent(new MouseEvent('click', {
         bubbles: true,
         cancelable: true,
         clientX: rect.left + rect.width / 2,
         clientY: rect.top + rect.height * 0.75,
       }));
       return true;
     })()`,
  );
  await delay(700);
  const afterClick = await probePdf(win);
  console.log(`[pdf] click-next page=${afterClick.page} clicked=${clickedNext}`);
  if (clickedNext !== true || afterClick.page !== (back.page ?? 0) + 1) {
    fail('click-next', { before: back.page, after: afterClick.page });
  }
  const wheeled = await win.webContents.executeJavaScript(
    `(() => {
       const view = document.querySelector('[data-testid="pdf-viewer"]');
       if (!view) return false;
       const rect = view.getBoundingClientRect();
       view.dispatchEvent(new WheelEvent('wheel', {
         bubbles: true,
         cancelable: true,
         deltaY: 120,
         clientX: rect.left + rect.width / 2,
         clientY: rect.top + rect.height / 2,
       }));
       return true;
     })()`,
  );
  await delay(800);
  const afterWheel = await probePdf(win);
  console.log(`[pdf] wheel-next page=${afterWheel.page} wheeled=${wheeled}`);
  if (wheeled !== true || afterWheel.page !== (afterClick.page ?? 0) + 1) {
    fail('wheel-next', { before: afterClick.page, after: afterWheel.page });
  }
  const currentPage = afterWheel.page ?? afterClick.page ?? previous;

  // 书签：在当前页加书签 → 往后翻两页 → 点书签跳回
  const markedPage = currentPage;
  const clickedAdd = await win.webContents.executeJavaScript(
    `(() => {
       const button = [...document.querySelectorAll('.reader-actions button')]
         .find((node) => node.textContent.includes('书签'));
       if (button) { button.click(); return true; }
       return false;
     })()`,
  );
  await delay(800);
  const withMark = await probePdf(win);
  if (clickedAdd !== true || withMark.marks < 1) fail('bookmark-add', withMark);
  for (let index = 0; index < 2; index += 1) {
    await pressKey(win, 'ArrowDown');
    await delay(500);
  }
  const moved = await probePdf(win);
  const clickedMark = await win.webContents.executeJavaScript(
    `(() => {
       const button = document.querySelector('.pdf-marks .mark-jump');
       if (button) { button.click(); return true; }
       return false;
     })()`,
  );
  await delay(800);
  const jumped = await probePdf(win);
  console.log(
    `[pdf] bookmark marked=${markedPage} moved=${moved.page} jumped=${jumped.page} clicked=${clickedMark}`,
  );
  if (clickedMark !== true || jumped.page !== markedPage) {
    fail('bookmark-jump', { markedPage, moved: moved.page, jumped: jumped.page });
  }

  // 收起书签面板，再进老板模式（Esc 要先退出老板模式，而不是关面板）
  await pressKey(win, 'Escape');
  await delay(400);

  // 老板模式：窗口缩到小窗后仍然渲染当前页；Esc 能从渲染层退出老板模式
  enterBoss(win);
  await delay(1600);
  const bossProbe = await probePdf(win);
  console.log('[pdf] boss ' + JSON.stringify(bossProbe));
  if (!bossProbe.boss) fail('boss-mode', bossProbe);
  if (!bossProbe.canvas || bossProbe.canvas.width === 0 || bossProbe.canvas.ratio < 0.002) {
    fail('boss-blank', bossProbe);
  }
  const bossShot = await win.webContents.capturePage();
  await fs.promises.writeFile(
    screenshotPath.replace(/\.png$/i, '-boss.png'),
    bossShot.toPNG(),
  );
  await pressKey(win, 'Escape');
  await delay(1400);
  const afterEsc = await probePdf(win);
  console.log(`[pdf] esc-exit-boss boss=${afterEsc.boss} page=${afterEsc.page}`);
  if (afterEsc.boss) {
    fail('esc-exit-boss', afterEsc);
    await exitBoss(win);
    await delay(1000);
  }

  // 进度：退出到书架再点回来，页码必须还在原处
  const beforeLeave = await probePdf(win);
  const expectedPage = beforeLeave.page;
  await win.webContents.executeJavaScript(
    `(() => {
       const button = [...document.querySelectorAll('.reader-bar button')]
         .find((node) => node.textContent.includes('书架'));
       if (button) { button.click(); return true; }
       return false;
     })()`,
  );
  await delay(1400);
  const reopened = await win.webContents.executeJavaScript(
    `(() => {
       const button = document.querySelector('.book-card .primary');
       if (button) { button.click(); return true; }
       return false;
     })()`,
  );
  await delay(2500);
  let restored = await probePdf(win);
  const deadline = Date.now() + 25000;
  while (
    Date.now() < deadline &&
    (!restored.total || !restored.canvas || restored.canvas.width === 0 || restored.loading)
  ) {
    await delay(400);
    restored = await probePdf(win);
  }
  console.log(`[pdf] reopen expected=${expectedPage} got=${restored.page} total=${restored.total}`);
  if (reopened !== true || restored.page !== expectedPage) {
    fail('progress-restore', { expectedPage, got: restored.page });
  }

  const shot = await win.webContents.capturePage();
  await fs.promises.writeFile(screenshotPath, shot.toPNG());
  console.log(`SCREENSHOT_OK ${screenshotPath} pdf`);
  console.log(`[pdf] done failures=${failures}`);
  return failures;
}


/**
 * 冒烟测试：启动后检查书架是否渲染，可选地把界面截图存下来（用于人工核对 UI）。
 * 只在 --smoke-test 模式下启用，不影响正常使用。
 */
function runSmokeTest(win: BrowserWindow): void {
  const screenshotPath = process.env.READER_SCREENSHOT;
  const openFirstBook = process.env.READER_SCREENSHOT_OPEN === '1';
  let smokeFailures = 0;

  /** 等某个元素出现：渲染层是异步加载书库的，固定 sleep 在慢机器上会点空。 */
  const waitForSelector = async (selector: string, timeoutMs = 20000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await win.webContents.executeJavaScript(
        `!!document.querySelector(${JSON.stringify(selector)})`,
      );
      if (found) return true;
      await delay(200);
    }
    return false;
  };

  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('SMOKE_FAIL renderer gone', details.reason);
    app.exit(1);
  });

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      win.webContents
        .executeJavaScript(
          `({ shelf: !!document.querySelector('[data-testid="shelf"]'), title: document.title })`,
        )
        .then(async (result: { shelf: boolean; title: string }) => {
          if (!result.shelf) {
            console.error('SMOKE_FAIL shelf not rendered');
            app.exit(1);
            return;
          }
          console.log(`SMOKE_OK title=${result.title}`);

          if (!screenshotPath) {
            app.exit(0);
            return;
          }
          if (process.env.READER_SMOKE_PDF === '1') {
            // PDF：打开第一本书，跑一页一屏的逐页断言
            if (!(await waitForSelector('.book-card .primary'))) {
              console.error('SMOKE_FAIL 书架没有加载出书籍卡片');
              app.exit(1);
              return;
            }
            const clickedBook = await win.webContents.executeJavaScript(
              `(() => { const btn = document.querySelector('.book-card .primary'); if (btn) { btn.click(); return true; } return false; })()`,
            );
            if (!(await waitForSelector('[data-testid="pdf-viewer"]'))) {
              const state = await win.webContents.executeJavaScript(
                `(() => ({
                   url: location.href,
                   hasShelf: !!document.querySelector('[data-testid="shelf"]'),
                   hasReader: !!document.querySelector('[data-testid="reader"]'),
                   cards: document.querySelectorAll('.book-card').length,
                   toast: document.querySelector('.toast')?.textContent || '',
                   text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
                 }))()`,
              );
              console.error(
                `SMOKE_FAIL 没有进入 PDF 阅读界面 clicked=${clickedBook} ${JSON.stringify(state)}`,
              );
              app.exit(1);
              return;
            }
            const failures = await runPdfSmoke(win, screenshotPath);
            if (failures > 0) {
              console.error(`SMOKE_FAIL PDF 断言未通过：${failures} 项`);
              app.exit(1);
              return;
            }
            app.exit(0);
            return;
          }
          if (process.env.READER_SMOKE_BOSS === '1') {
            // 冒烟时顺带验证老板模式：真实缩放窗口 + 透明度
            if (!(await waitForSelector('.book-card .primary'))) {
              console.error('SMOKE_FAIL 书架没有加载出书籍卡片');
              app.exit(1);
              return;
            }
            await win.webContents.executeJavaScript(
              `document.querySelector('.book-card .primary')?.click()`,
            );
            if (!(await waitForSelector('.page-frame'))) {
              console.error('SMOKE_FAIL 没有进入阅读界面');
              app.exit(1);
              return;
            }
            await delay(600);
            enterBoss(win);
            await delay(1200);
            const shot = await win.webContents.capturePage();
            await fs.promises.writeFile(screenshotPath, shot.toPNG());
            console.log(`SCREENSHOT_OK ${screenshotPath} boss=${bossMode} tint=${bossTintValue()}`);
            // 顺带截一张整屏，看看老板模式叠在真实桌面上是什么样
            if (process.env.READER_SMOKE_SCREEN) {
              const display = screen.getPrimaryDisplay();
              const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: {
                  width: Math.round(display.size.width * display.scaleFactor),
                  height: Math.round(display.size.height * display.scaleFactor),
                },
              });
              await fs.promises.writeFile(process.env.READER_SMOKE_SCREEN, sources[0].thumbnail.toPNG());
              console.log(`SCREEN_OK ${process.env.READER_SMOKE_SCREEN}`);
            }
            app.exit(0);
            return;
          }
          if (process.env.READER_SMOKE_BOSS_MAX === '1') {
            // 验证「最大化状态下进老板模式」也能缩到左下角
            win.maximize();
            await delay(600);
            console.log(`[boss-max] before=${JSON.stringify(win.getBounds())} maximized=${win.isMaximized()}`);
            enterBoss(win);
            await delay(800);
            const bossBounds = win.getBounds();
            console.log(`[boss-max] after=${JSON.stringify(bossBounds)} opacity=${win.getOpacity()}`);
            const shot = await win.webContents.capturePage();
            await fs.promises.writeFile(screenshotPath, shot.toPNG());
            await exitBoss(win);
            await delay(500);
            console.log(`[boss-max] restored=${JSON.stringify(win.getBounds())} maximized=${win.isMaximized()}`);
            app.exit(0);
            return;
          }
          if (process.env.READER_SMOKE_STATS === '1') {
            await win.webContents.executeJavaScript(
              `(() => {
                 const btn = [...document.querySelectorAll('.shelf-actions button')]
                   .find((node) => node.textContent.includes('统计'));
                 if (btn) { btn.click(); return true; }
                 return false;
               })()`,
            );
            await delay(900);
            const shot = await win.webContents.capturePage();
            await fs.promises.writeFile(screenshotPath, shot.toPNG());
            console.log(`SCREENSHOT_OK ${screenshotPath} stats`);
            app.exit(0);
            return;
          }
          if (process.env.READER_SMOKE_ASSERT) {
            await win.webContents.executeJavaScript(`window.__READER_DEBUG__ = true`);
          }
          if (openFirstBook) {
            // 先等书架里的书卡出来再点，避免在慢机器上点到空处
            if (!(await waitForSelector('.book-card .primary'))) {
              console.error('SMOKE_FAIL 书架没有加载出书籍卡片');
              app.exit(1);
              return;
            }
            const clicked = await win.webContents.executeJavaScript(
              `(() => { const btn = document.querySelector('.book-card .primary'); if (btn) { btn.click(); return true; } return false; })()`,
            );
            if (clicked !== true || !(await waitForSelector('.page-frame, [data-testid="pdf-viewer"]'))) {
              console.error('SMOKE_FAIL 点击书籍后没有进入阅读界面');
              app.exit(1);
              return;
            }
            await delay(800);
          }
          if (process.env.READER_SMOKE_BOOKMARK_JUMP === '1') {
            // 同一章内书签跳转：翻几页 → 加书签 → 再翻几页 → 点书签，页码必须回到原处
            const press = async () => {
              await win.webContents.executeJavaScript(
                `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`,
              );
              await delay(400);
            };
            const readStatus = async (): Promise<string> =>
              String(
                await win.webContents.executeJavaScript(
                  `((document.querySelector('[data-testid="reader-footer"]') || document.querySelector('.reader-status'))?.textContent || '').replace(/\\s+/g, ' ').trim()`,
                ),
              );
            const pageOf = (text: string): number => {
              const matched = /(\d+)\s*\/\s*\d+\s*·/.exec(text);
              return matched ? Number(matched[1]) : -1;
            };
            for (let i = 0; i < 5; i += 1) await press();
            const atMark = await readStatus();
            await win.webContents.executeJavaScript(
              `(() => { const b = [...document.querySelectorAll('.reader-actions button')].find((n) => n.textContent.includes('书签')); if (b) { b.click(); return true; } return false; })()`,
            );
            await delay(900);
            for (let i = 0; i < 5; i += 1) await press();
            const moved = await readStatus();
            const clicked = await win.webContents.executeJavaScript(
              `(() => { const b = document.querySelector('.mark-jump'); if (b) { b.click(); return true; } return false; })()`,
            );
            await delay(900);
            const back = await readStatus();
            const ok =
              clicked === true && pageOf(atMark) > 0 && pageOf(atMark) === pageOf(back) && pageOf(moved) !== pageOf(back);
            console.log(
              `[bookmark] atMark=${JSON.stringify(atMark)} moved=${JSON.stringify(moved)} back=${JSON.stringify(back)} clicked=${clicked} ${ok ? 'OK' : 'FAIL'}`,
            );
            if (!ok) smokeFailures += 1;
          }
          if (process.env.READER_SMOKE_IMAGES === '1') {
            // 往后翻，直到本页同时出现「文字 + 图片」，检查图文混排
            for (let i = 0; i < 120; i += 1) {
              const state = await win.webContents.executeJavaScript(
                `(() => {
                   const frame = document.querySelector('.page-frame')?.getBoundingClientRect();
                   const visible = [...document.querySelectorAll('.book-image img')].filter((img) => {
                     const rect = img.getBoundingClientRect();
                     return frame && rect.bottom > frame.top + 1 && rect.top < frame.bottom - 1;
                   }).length;
                   const text = (document.querySelector('.page-columns')?.innerText || '').trim().length;
                   return { images: visible, text };
                 })()`,
              );
              if (state.images > 0 && state.text > 30) break;
              await win.webContents.executeJavaScript(
                `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`,
              );
              await delay(220);
            }
            await delay(800);
            const info = await win.webContents.executeJavaScript(
              `(() => {
                 const nodes = [...document.querySelectorAll('.book-image img')];
                 return {
                   count: nodes.length,
                   loaded: nodes.filter((img) => img.complete && img.naturalWidth > 0).length,
                   sizes: nodes.map((img) => img.naturalWidth + 'x' + img.naturalHeight),
                   frames: [...document.querySelectorAll('.book-image-frame')].map((el) => Math.round(el.getBoundingClientRect().height)),
                   footer: (document.querySelector('[data-testid="reader-footer"]')?.textContent || '').replace(/\s+/g, ' ').trim(),
                 };
               })()`,
            );
            console.log('[images] ' + JSON.stringify(info));
            if (info.count === 0 || info.loaded === 0) {
              console.error('SMOKE_FAIL 图文页没有加载出图片');
              smokeFailures += 1;
            }
            const shot = await win.webContents.capturePage();
            await fs.promises.writeFile(screenshotPath, shot.toPNG());
            console.log('SCREENSHOT_OK ' + screenshotPath + ' images');
            if (smokeFailures > 0) {
              console.error(`SMOKE_FAIL 图片冒烟未通过：${smokeFailures} 项`);
              app.exit(1);
              return;
            }
            app.exit(0);
            return;
          }
          if (process.env.READER_SMOKE_NEXT) {
            const times = Number(process.env.READER_SMOKE_NEXT) || 1;
            for (let i = 0; i < times; i += 1) {
              await win.webContents.executeJavaScript(
                `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`,
              );
              await delay(400);
            }
            await delay(700);
          }
          if (process.env.READER_SMOKE_SEARCH) {
            const keyword = process.env.READER_SMOKE_SEARCH;
            await win.webContents.executeJavaScript(
              `(() => {
                 const btn = [...document.querySelectorAll('.reader-actions button')]
                   .find((node) => node.textContent.includes('搜索'));
                 if (btn) { btn.click(); return true; }
                 return false;
               })()`,
            );
            await delay(400);
            await win.webContents.executeJavaScript(
              `(() => {
                 const input = document.querySelector('.search-input');
                 if (!input) return false;
                 const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                 setter.call(input, ${JSON.stringify(keyword)});
                 input.dispatchEvent(new Event('input', { bubbles: true }));
                 return true;
               })()`,
            );
            await delay(800);
            if (process.env.READER_SMOKE_SEARCH_CLICK === '1') {
              await win.webContents.executeJavaScript(
                `(() => { const hit = document.querySelector('.search-hit'); if (hit) { hit.click(); return true; } return false; })()`,
              );
              await delay(900);
            }
          }
          if (process.env.READER_SMOKE_SETTINGS === '1') {
            await win.webContents.executeJavaScript(
              `(() => {
                 const btn = [...document.querySelectorAll('.reader-actions button')]
                   .find((node) => node.textContent.trim() === '设置');
                 if (btn) { btn.click(); return true; }
                 return false;
               })()`,
            );
            await delay(700);
          }
          if (process.env.READER_SMOKE_SWEEP) {
            // 连续翻页并逐页统计正文区深色像素，用来抓空白页/跳段
            const times = Number(process.env.READER_SMOKE_SWEEP) || 10;
            const report: string[] = [];
            for (let index = 0; index < times; index += 1) {
              await delay(320);
              const shot = await win.webContents.capturePage();
              const size = shot.getSize();
              const bitmap = shot.toBitmap();
              let dark = 0;
              let total = 0;
              const x0 = Math.floor(size.width * 0.25);
              const x1 = Math.floor(size.width * 0.9);
              const y0 = Math.floor(size.height * 0.12);
              const y1 = Math.floor(size.height * 0.9);
              for (let y = y0; y < y1; y += 3) {
                for (let x = x0; x < x1; x += 3) {
                  const offset = (y * size.width + x) * 4;
                  const value = (bitmap[offset] + bitmap[offset + 1] + bitmap[offset + 2]) / 3;
                  total += 1;
                  if (value < 140) dark += 1;
                }
              }
              const ratio = total > 0 ? (dark / total) * 100 : 0;
              const meta = await win.webContents.executeJavaScript(
                `(document.querySelector('[data-testid="reader-footer"]')?.textContent ?? '')
                   .replace(/\s+/g, ' ').trim()`,
              );
              report.push(`${index + 1}:${ratio.toFixed(2)}%[${meta}]`);
              if (ratio < 0.5) {
                await fs.promises.writeFile(
                  screenshotPath.replace('.png', `-blank-${index + 1}.png`),
                  shot.toPNG(),
                );
              }
              await win.webContents.executeJavaScript(
                `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`,
              );
            }
            console.log('[sweep] ' + report.join(' '));
          }
          if (process.env.READER_SMOKE_ASSERT) {
            // 逐页断言：每页必须有字、没有半截行、页码只增不减（换章从 1 开始）
            const times = Number(process.env.READER_SMOKE_ASSERT) || 10;
            const inBoss = process.env.READER_SMOKE_ASSERT_BOSS === '1';
            const doResize = process.env.READER_SMOKE_ASSERT_RESIZE === '1';
            let failures = 0;
            let first = true;
            let prevPage = 0;
            let prevChapter = 0;
            let resized = false;
            let justResized = false;
            if (inBoss) {
              enterBoss(win);
              await delay(1400);
            }
            if (!inBoss) {
              // 等后台把全书页数算完（页脚出现「全书 N / M 页」），否则页码会在统计完成时从
              // 「本章第几页」跳成「全书第几页」，断言会误判
              const deadline = Date.now() + 25000;
              while (Date.now() < deadline) {
                const footerText = String(
                  await win.webContents.executeJavaScript(
                    `(document.querySelector('[data-testid="reader-footer"]')?.textContent || '')`,
                  ),
                );
                if (footerText.includes('全书')) break;
                await delay(300);
              }
            }
            console.log(`[assert] window=${JSON.stringify(win.getBounds())}`);
            for (let index = 0; index < times; index += 1) {
              if (doResize && !resized && index === Math.floor(times / 2)) {
                const bounds = win.getBounds();
                win.setBounds({
                  x: bounds.x,
                  y: bounds.y,
                  width: Math.max(960, bounds.width - 260),
                  height: Math.max(640, bounds.height - 180),
                });
                resized = true;
                justResized = true;
                await delay(1200);
              }
              await delay(360);
              const probe: {
                error?: string;
                height: number;
                scrollTop: number;
                scrollHeight: number;
                visibleLines: number;
                cutLines: number;
                topCut: number;
                bottomCut: number;
                frameTop: number;
                near: Array<{ top: number; bottom: number; pi: number; text: string }>;
                originsNear: number[] | null;
                boxesNear: Array<{ pi: number; measured: number; now: number; text: string }> | null;
                columnsOffset: number;
                firstOffset: number | null;
                styles: Record<string, string | number>;
                firstVisible: string;
                bossState: string;
                footer: string;
              } = await win.webContents.executeJavaScript(
                `(() => {
                   const frame = document.querySelector('.page-frame');
                   const cols = document.querySelector('.page-columns');
                   if (!frame || !cols) return { error: 'no-page' };
                   const fr = frame.getBoundingClientRect();
                   const ps = Array.from(cols.children);
                   const columnsOffset =
                     Math.round((cols.getBoundingClientRect().top - fr.top + frame.scrollTop) * 10) / 10;
                   const firstOffset =
                     ps.length > 0
                       ? Math.round(
                           (ps[0].getBoundingClientRect().top - fr.top + frame.scrollTop) * 10,
                         ) / 10
                       : null;
                   const styles = {
                     colPadTop: getComputedStyle(cols).paddingTop,
                     colMarginTop: getComputedStyle(cols).marginTop,
                     colWidth: Math.round(cols.getBoundingClientRect().width),
                     framePadTop: getComputedStyle(frame).paddingTop,
                     frameScroll: frame.scrollTop,
                     colOffsetTop: cols.offsetTop,
                     colParent: cols.offsetParent ? cols.offsetParent.className : null,
                     frameScrollHeight: frame.scrollHeight,
                     frameClientHeight: frame.clientHeight,
                   };
                   const lines = [];
                   let visibleLines = 0;
                   let cutLines = 0;
                   let topCut = 0;
                   let bottomCut = 0;
                   let firstVisible = '';
                   const near = [];
                   for (let pi = 0; pi < ps.length; pi += 1) {
                     const range = document.createRange();
                     range.selectNodeContents(ps[pi]);
                     const rects = Array.from(range.getClientRects());
                     for (const r of rects) {
                       lines.push({ top: r.top - fr.top, bottom: r.bottom - fr.top, pi });
                     }
                   }
                   lines.sort((a, b) => a.top - b.top);
                   for (const line of lines) {
                     if (line.top > -80 && line.top < 80) {
                       near.push({
                         top: Math.round(line.top * 10) / 10,
                         bottom: Math.round(line.bottom * 10) / 10,
                         pi: line.pi,
                         text: (ps[line.pi]?.textContent ?? '').trim().slice(0, 10),
                       });
                     }
                     const intersects = line.bottom > 0.5 && line.top < fr.height - 0.5;
                     if (!intersects) continue;
                     visibleLines += 1;
                     if (line.top < -0.5 || line.bottom > fr.height + 0.5) cutLines += 1;
                     if (line.top < -0.5) topCut = Math.max(topCut, -line.top);
                     if (line.bottom > fr.height + 0.5) bottomCut = Math.max(bottomCut, line.bottom - fr.height);
                     if (line.top >= -0.5 && line.bottom <= fr.height + 0.5 && !firstVisible) {
                       firstVisible = (ps[line.pi]?.textContent ?? '').trim().slice(0, 18);
                     }
                   }
                   const footerNode = document.querySelector('[data-testid="reader-footer"]') || document.querySelector('.reader-status');
                   const bossNode = document.querySelector('.boss-state');
                   const dbg = window.__pagingDebug;
                   let originsNear = null;
                   if (dbg && Array.isArray(dbg.origins)) {
                     originsNear = dbg.origins
                       .filter((value) => Math.abs(value - frame.scrollTop) < 200)
                       .slice(0, 6)
                       .map((value) => Math.round(value * 10) / 10);
                   }
                   let boxesNear = null;
                   if (dbg && Array.isArray(dbg.boxes)) {
                     // 测量时记录下来的段落框，和现在 DOM 里同一段的位置对照
                     boxesNear = [];
                     for (let pi = 12; pi < 20 && pi < ps.length && pi < dbg.boxes.length; pi += 1) {
                       const nowTop = ps[pi].getBoundingClientRect().top - fr.top + frame.scrollTop;
                       boxesNear.push({
                         pi,
                         measured: Math.round(dbg.boxes[pi].top * 10) / 10,
                         now: Math.round(nowTop * 10) / 10,
                         text: (ps[pi].textContent ?? '').trim().slice(0, 8),
                       });
                     }
                   }
                   return {
                     height: Math.round(fr.height),
                     scrollTop: Math.round(frame.scrollTop),
                     scrollHeight: frame.scrollHeight,
                     visibleLines,
                     cutLines,
                     topCut: Math.round(topCut * 10) / 10,
                     bottomCut: Math.round(bottomCut * 10) / 10,
                     frameTop: Math.round(fr.top * 10) / 10,
                     near,
                     originsNear,
                     boxesNear,
                     columnsOffset,
                     firstOffset,
                     styles,
                     firstVisible,
                     bossState: (bossNode?.textContent ?? '').replace(/\s+/g, ' ').trim(),
                     footer: (footerNode?.textContent ?? '').replace(/\s+/g, ' ').trim(),
                   };
                 })()`,
              );
              if (probe.error) {
                failures += 1;
                console.log(`[assert] ${index + 1} ERROR ${probe.error}`);
                break;
              }
              const bookMatch = new RegExp('全书[ 　]*([0-9]+)[ 　]*/[ 　]*([0-9]+)[ 　]*页').exec(probe.footer);
              const chapterPageMatch = new RegExp('本章[ 　]*([0-9]+)[ 　]*/[ 　]*([0-9]+)').exec(probe.footer);
              const chapterMatch = new RegExp('第[ 　]*([0-9]+)[ 　]*/[ 　]*([0-9]+)[ 　]*章').exec(probe.footer);
              let pageNo = bookMatch
                ? Number(bookMatch[1])
                : chapterPageMatch
                  ? Number(chapterPageMatch[1])
                  : -1;
              const chapterNo = chapterMatch ? Number(chapterMatch[1]) : -1;
              if (pageNo < 0) {
                // 老板模式没有页脚，页码在顶部状态条里
                const bossParsed = new RegExp('([0-9]+)[ 　]*/[ 　]*([0-9]+)[ 　]*$').exec(probe.bossState);
                if (bossParsed) pageNo = Number(bossParsed[1]);
              }
              const blank = probe.visibleLines === 0;
              const cut = probe.cutLines > 0;
              const stepped =
                // 老板模式没有页脚/工具栏，读不到页码，只校验空白页与半截行
                inBoss ||
                first ||
                justResized ||
                (bookMatch
                  ? pageNo === prevPage + 1 ||
                    (chapterNo !== -1 && chapterNo !== prevChapter && pageNo >= prevPage)
                  : pageNo === prevPage + 1 ||
                    (pageNo === 1 && (chapterNo === -1 || chapterNo !== prevChapter)));
              if (first) console.log('[footer] ' + probe.footer);
              if (blank) failures += 1;
              if (cut) failures += 1;
              if (!stepped) failures += 1;
              console.log(
                `[assert] ${index + 1} page=${pageNo} ch=${chapterNo} h=${probe.height} ` +
                  `lines=${probe.visibleLines} cut=${probe.cutLines} scroll=${probe.scrollTop}/${probe.scrollHeight} ` +
                  `cutPx=${probe.topCut}/${probe.bottomCut} ` +
                  `first=${JSON.stringify(probe.firstVisible)}` +
                  (blank || cut || !stepped ? ` FAIL(blank=${blank},cut=${cut},step=${stepped})` : '') +
                  (cut ? ` near=${JSON.stringify(probe.near)} colOff=${probe.columnsOffset}/${probe.firstOffset} ${JSON.stringify(probe.styles)} boxes=${JSON.stringify(probe.boxesNear)}` : ''),
              );
              first = false;
              justResized = false;
              prevPage = pageNo;
              prevChapter = chapterNo;
              await win.webContents.executeJavaScript(
                `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`,
              );
            }
            if (inBoss) {
              await exitBoss(win);
              await delay(600);
            }
            console.log(`[assert] done failures=${failures}/${times}`);
            smokeFailures += failures;
          }
          if (process.env.READER_SMOKE_PROBE === '1') {
            const result = await win.webContents.executeJavaScript(
              `(async () => {
                 const out = {};
                 out.hasApi = typeof window.reader.window.setHotkey;
                 try { out.setResult = await window.reader.window.setHotkey('F8'); }
                 catch (e) { out.setError = String(e && e.message || e); }
                 out.state = await window.reader.window.getState();
                 return out;
               })()`,
            );
            console.log('[probe] ' + JSON.stringify(result));
          }
          if (process.env.READER_SMOKE_HOTKEY) {
            // 复现「点了热键按钮再按键盘」的流程
            await win.webContents.executeJavaScript(
              `(() => { const btn = document.querySelector('.hotkey-key'); if (btn) { btn.click(); return true; } return false; })()`,
            );
            await delay(300);
            const before = await win.webContents.executeJavaScript(
              `document.querySelector('.hotkey-key')?.textContent ?? 'MISSING'`,
            );
            await win.webContents.executeJavaScript(
              `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(process.env.READER_SMOKE_HOTKEY)}, bubbles: true }))`,
            );
            await delay(600);
            const after = await win.webContents.executeJavaScript(
              `document.querySelector('.hotkey-key')?.textContent ?? 'MISSING'`,
            );
            const errText = await win.webContents.executeJavaScript(
              `document.querySelector('.settings-error')?.textContent ?? ''`,
            );
            console.log(`[hotkey] before=${JSON.stringify(before)} after=${JSON.stringify(after)} error=${JSON.stringify(errText)}`);
          }
          if (process.env.READER_SMOKE_NO_TOC === '1') {
            await win.webContents.executeJavaScript(
              `(() => {
                 const btn = [...document.querySelectorAll('.reader-actions button')]
                   .find((node) => node.textContent.trim() === '目录');
                 if (btn) { btn.click(); return true; }
                 return false;
               })()`,
            );
            await delay(600);
            const geo = await win.webContents.executeJavaScript(
              `(() => {
                 const frame = document.querySelector('.page-frame');
                 const view = document.querySelector('.page-viewport');
                 if (!frame || !view) return null;
                 const f = frame.getBoundingClientRect();
                 const v = view.getBoundingClientRect();
                 return { frameLeft: Math.round(f.left), frameW: Math.round(f.width), viewLeft: Math.round(v.left), viewW: Math.round(v.width) };
               })()`,
            );
            console.log('[toc-hidden] ' + JSON.stringify(geo));
          }
          if (process.env.READER_SMOKE_BOOKMARK === '1') {
            await win.webContents.executeJavaScript(
              `(() => {
                 const btn = [...document.querySelectorAll('.reader-actions button')]
                   .find((node) => node.textContent.includes('书签'));
                 if (btn) { btn.click(); return true; }
                 return false;
               })()`,
            );
            await delay(800);
          }
          const image = await win.webContents.capturePage();
          await fs.promises.writeFile(screenshotPath, image.toPNG());
          console.log(`SCREENSHOT_OK ${screenshotPath}`);
          if (smokeFailures > 0) {
            console.error(`SMOKE_FAIL 逐页断言未通过：${smokeFailures} 项`);
            app.exit(1);
            return;
          }
          app.exit(0);
        })
        .catch((error: unknown) => {
          console.error('SMOKE_FAIL', error);
          app.exit(1);
        });
    }, 1200);
  });
}

void app.whenReady().then(async () => {
  registerIpc();
  const store = await getStore();
  // 冒烟测试入口：先把指定的 PDF 导入当前数据目录，界面里才会出现这本书
  if (SMOKE_TEST && process.env.READER_SMOKE_PDF_FILE) {
    try {
      const book = await importBookFile(store, libraryBaseDir(), process.env.READER_SMOKE_PDF_FILE);
      console.log(`[smoke] 已导入 PDF：${book.title}（${book.id}）`);
    } catch (error) {
      console.error('[smoke] 导入 PDF 失败', error);
    }
  }
  await loadWindowState();
  const win = createWindow();
  registerGlobalShortcuts();
  if (SMOKE_TEST) runSmokeTest(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
