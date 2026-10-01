'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const os = require('os');

// Notes, tasks and wiki live in a plain folder outside the app bundle so the
// packaged .app can write to them and other tools (Obsidian, the scheduled AI
// prompts) can read them. Must be set before server.js is required.
process.env.SECONDBRAIN_DATA_DIR ||= path.join(os.homedir(), 'Documents', 'SecondBrain');

// Single-instance lock: if a second instance is launched (e.g. via the Dock
// launcher while already running), quit the newcomer and show the window in
// the existing instance instead.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => bringToFront());
  main();
}

// ---------------------------------------------------------------------------

let tray = null;
let win  = null;
let isQuitting = false;
let serverReady = false;

const PORT    = 3456;
const APP_URL = `http://localhost:${PORT}`;

const ASSET = (name) => path.join(__dirname, 'assets', name);

const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVR42mNgYGD4TyEeNWDUgFEDhocBAJvM/wFK6ATsAAAAAElFTkSuQmCC';

// Aggressively bring the window to front — works even when another app has focus.
function bringToFront() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
  win.focus();
}

function main() {

  // ── Server ────────────────────────────────────────────────────────────────

  function startServer() {
    let server;
    try { server = require('./server.js'); }
    catch (err) { console.error('[main] server.js failed to load:', err); return; }

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log('[main] Port already in use — connecting to existing server');
        serverReady = true;
        openWindow();
      } else {
        console.error('[main] Server error:', err);
      }
    });

    server.on('listening', () => {
      console.log(`[main] Server ready → ${APP_URL}`);
      serverReady = true;
      openWindow();
    });
  }

  // ── Window ────────────────────────────────────────────────────────────────

  function openWindow() {
    if (win) { bringToFront(); return; }

    win = new BrowserWindow({
      width: 1460,
      height: 820,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    win.loadURL(APP_URL);

    // Keep the app window pinned to the local app. Any external http(s) link
    // (e.g. a wiki link) opens in the user's default browser instead of
    // navigating this window away — that's what used to strand the window on a
    // page it couldn't load.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(APP_URL)) {
        e.preventDefault();
        if (/^https?:/i.test(url)) shell.openExternal(url);
      }
    });

    // If a load fails, recover instead of leaving a blank/broken window:
    //  • main app URL failing usually means the server is still starting → retry
    //  • anything else → go back if we can, otherwise return to the app home
    win.webContents.on('did-fail-load', (e, errorCode, errorDesc, validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED — user-initiated, ignore
      setTimeout(() => {
        if (!win) return;
        if (!validatedURL || validatedURL.startsWith(APP_URL)) {
          win.loadURL(APP_URL);
        } else if (win.webContents.canGoBack()) {
          win.webContents.goBack();
        } else {
          win.loadURL(APP_URL);
        }
      }, 600);
    });

    win.once('ready-to-show', () => bringToFront());

    // Close button hides the window; the app keeps running in the menu bar.
    win.on('close', (e) => {
      if (!isQuitting) { e.preventDefault(); win.hide(); }
    });
  }

  // ── Menu ──────────────────────────────────────────────────────────────────

  function buildMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Find…',
            accelerator: 'CmdOrCtrl+F',
            click: () => {
              if (win) win.webContents.executeJavaScript('window.openFindBar && window.openFindBar()');
            },
          },
        ],
      },
      {
        label: 'History',
        submenu: [
          {
            label: 'Back',
            accelerator: 'CmdOrCtrl+[',
            click: () => { if (win && win.webContents.canGoBack()) win.webContents.goBack(); },
          },
          {
            label: 'Forward',
            accelerator: 'CmdOrCtrl+]',
            click: () => { if (win && win.webContents.canGoForward()) win.webContents.goForward(); },
          },
          { type: 'separator' },
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: () => { if (win) win.loadURL(APP_URL); },
          },
        ],
      },
      { role: 'windowMenu' },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // ── Tray ──────────────────────────────────────────────────────────────────

  function createTray() {
    let icon = nativeImage.createFromPath(ASSET('tray-iconTemplate.png'));
    if (icon.isEmpty()) {
      console.warn('[main] Tray icon missing — using fallback');
      icon = nativeImage.createFromDataURL(FALLBACK_ICON);
    }

    tray = new Tray(icon);
    tray.setToolTip('Knowledge Base');
    tray.on('click', toggleWindow);

    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]));
  }

  function toggleWindow() {
    if (!serverReady) return;
    if (!win || !win.isVisible()) { openWindow(); } else { win.hide(); }
  }

  // ── App lifecycle ─────────────────────────────────────────────────────────

  app.whenReady().then(() => {
    if (app.dock) {
      const dockIcon = nativeImage.createFromPath(ASSET('icon.png'));
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    }

    // Auto-launch at login. `openAsHidden` keeps the window closed at login —
    // the tray icon is visible, and clicking it (or the dock icon) opens the
    // window. Only register when running from the packaged .app to avoid
    // installing dev builds as login items.
    if (process.platform === 'darwin' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    }

    buildMenu();
    createTray();
    startServer();
  });

  // Clicking the Dock icon shows the window.
  app.on('activate', () => {
    if (serverReady) openWindow();
    else if (win) bringToFront();
  });

  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { isQuitting = true; });
}
