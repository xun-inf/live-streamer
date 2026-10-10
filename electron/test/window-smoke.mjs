// 运行真实 Electron、renderer 服务和 media-service；所有测试窗口及原生画面保持隐藏。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import ts from 'typescript';
import { app, BrowserWindow } from 'electron';
import { mediaService } from '../dist/main/mediaService/index.js';
import { mainWindow } from '../dist/main/windows/mainWindow.js';
import { childWindow } from '../dist/main/windows/childWindow.js';
import { windowManager } from '../dist/main/windows/windowManager.js';
import { NativeWindow } from '../dist/main/mediaService/NativeWindow.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const output = path.join(root, 'build', devServerUrl ? 'multi-window-smoke-dev' : 'multi-window-smoke');
fs.mkdirSync(output, { recursive: true });
// Production pages cannot load TS directly; compile only this layout fixture for the test.
const layoutFixture = path.join(output, 'nativeWindow.mjs');
if (!devServerUrl) {
  const source = fs.readFileSync(path.join(root, 'electron/src/app/components/NativePreview/nativeWindow.ts'), 'utf8');
  fs.writeFileSync(layoutFixture, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
}
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'running' }));
app.disableHardwareAcceleration();
app.setPath('userData', path.join(output, 'profile'));
app.setPath('sessionData', path.join(output, 'profile'));
process.argv.push('--devtools=0', '--media-service-exe=' + path.join(root, 'build/bin/Debug/media-service.exe'),
  '--main-log=' + path.join(output, 'main.log'), '--media-service-log=' + path.join(output, 'media-service.log'),
  '--pipe-name=\\\\.\\pipe\\multi-window-smoke-' + process.pid);

const errors = [];
const checks = [];
const operations = [];
const navigationTrace = [];
const visibility = new Map();
app.on('browser-window-created', (_event, window) => {
  visibility.set(window.id, false);
  window.show = () => { visibility.set(window.id, true); window.emit('show'); };
  window.hide = () => { visibility.set(window.id, false); window.emit('hide'); };
  window.isVisible = () => visibility.get(window.id) ?? false;
  window.focus = () => {};
  window.webContents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
  window.webContents.on('console-message', details => {
    if (details.level === 'error') errors.push(details.message);
  });
});

const manager = mediaService.nativeWindowMgr;
for (const method of ['attach', 'setRect', 'detach', 'release']) {
  const original = NativeWindow.prototype[method];
  NativeWindow.prototype[method] = function (...args) {
    operations.push({ id: this.id, method, args: args.map(value => typeof value === 'bigint' ? value.toString() : value) });
    return method === 'attach' ? original.call(this, args[0], false) : original.apply(this, args);
  };
}
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(message);
};
let finished = false;
function report(error) {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ checks, errors, navigationTrace, error: error?.stack }, null, 2));
}
async function fail(error) {
  if (finished) return;
  finished = true;
  report(error);
  await mediaService.stop();
  app.exit(1);
}
const watchdog = setTimeout(() => { void fail(new Error('Smoke test timed out')); }, 60000);

async function run() {
  try {
    assert.equal(mainWindow.target, null);
    assert.throws(() => mainWindow.create(), /must be initialized/);
    assert.equal(childWindow.target, null);
    assert.throws(() => childWindow.create(), /must be initialized/);
    await import('../dist/main/main.js');
    // Exercise a second page URL without adding a product page just for the test.
    const testPageUrl = new URL(globalThis.windowConfig.pageUrls.Settings);
    testPageUrl.searchParams.set('fixture', 'another-page');
    globalThis.windowConfig.pageUrls.Test = testPageUrl.href;
    // childWindow 在 whenReady 回调创建，动态导入完成后需从快照取实际窗口。
    await waitFor(() => mainWindow.ready && mediaService.connected && windowManager.list().length === 2,
      'Fixed windows/service did not initialize');
    const main = mainWindow.target;
    mainWindow.create();
    assert.equal(mainWindow.target, main);
    assert.throws(() => mainWindow.initialize({}), /already initialized/);
    const childId = windowManager.list().find(state => state.id === 'child').wid;
    const childTarget = BrowserWindow.fromId(childId);
    assert.equal(childWindow.target, childTarget);
    assert.equal(childTarget.getParentWindow(), main);
    assert.equal(childTarget.isAlwaysOnTop(), false);
    childWindow.create();
    assert.equal(childWindow.target, childTarget);
    assert.throws(() => childWindow.initialize({}), /already initialized/);
    const invoke = (window, code) => window.webContents.executeJavaScript(code);
    const call = (window, method, ...args) => invoke(window,
      "require('electron').ipcRenderer.invoke('windows:request', " + JSON.stringify(method) + ", " + JSON.stringify(args) + ")");
    const displayed = async (window, title) => window.getTitle() === title && await invoke(window, "document.querySelector('.settings-page') !== null");
    const state = id => windowManager.list().find(item => item.id === id);
    const attached = id => operations.some(op => op.id === id && op.method === 'attach' && op.args[1] === true);
    await waitFor(() => attached(0), 'Main preview missing');
    assert.equal(childTarget.isVisible(), false);
    assert.equal(globalThis.nativeWindowMgr, manager);
    checks.push('main and hidden child are pre-created; native manager remains shared');

    const loaded = async (window, name) => {
      if (devServerUrl && name === 'Main') name = 'Main/index';
      if (!devServerUrl) name = { Main: 'main', Settings: 'settings' }[name] ?? name;
      // file:// resources do not reliably appear in Resource Timing; inspect parsed scripts.
      const scripts = [];
      const debuggerClient = window.webContents.debugger;
      const onMessage = (_event, method, params) => {
        if (method === 'Debugger.scriptParsed') scripts.push(params.url);
      };
      debuggerClient.attach('1.3');
      debuggerClient.on('message', onMessage);
      try {
        await debuggerClient.sendCommand('Debugger.enable');
        return scripts.some(url => new RegExp('/' + name + (devServerUrl ? '\\.tsx(?:\\?|$)' : '-[^/]+\\.js(?:\\?|$)')).test(url));
      } finally {
        debuggerClient.removeListener('message', onMessage);
        debuggerClient.detach();
      }
    };
    await waitFor(() => invoke(childTarget, "document.getElementById('business-title') !== null"), 'Child shell did not load');
    assert.equal(new URL(main.webContents.getURL()).pathname.endsWith('/main.html'), true);
    assert.equal(new URL(childTarget.webContents.getURL()).pathname.endsWith('/settings.html'), true);
    assert.equal(await loaded(main, 'Main'), true);
    assert.equal(await loaded(childTarget, 'Settings'), true);
    for (const name of ['Settings']) {
      assert.equal(await loaded(main, name), false, 'Main eagerly loaded ' + name);
    }
    for (const name of ['Main']) {
      assert.equal(await loaded(childTarget, name), false, 'Child eagerly loaded ' + name);
    }
    checks.push('Main and Settings load separate business page entries');

    await invoke(main, `(() => {
      const mgr = require('@electron/remote').getGlobal('nativeWindowMgr');
      mgr.create('secondary');
      mgr.setRect('secondary', { x: 10, y: 20, width: 100, height: 80, dpr: 2 });
      mgr.setVisible('secondary', true);
    })()`);
    const secondary = manager.list().find(entry => entry.key === 'secondary').id;
    const sequence = operations.filter(op => op.id === secondary);
    assert.equal(sequence[0].method, 'attach');
    assert.equal(sequence[0].args[1], false);
    assert.equal(sequence[1].method, 'setRect');
    assert.deepEqual(sequence[1].args, [20, 40, 200, 160]);
    assert.equal(sequence[2].method, 'attach');
    assert.equal(sequence[2].args[1], true);
    assert.equal(sequence[0].args[0], operations.find(op => op.id === 0 && op.method === 'attach').args[0]);
    await invoke(main, "require('@electron/remote').getGlobal('nativeWindowMgr').release('secondary')");
    assert.ok(operations.some(op => op.id === secondary && op.method === 'release'));
    assert.deepEqual(manager.list(), [{ key: 'preview', id: 0 }]);
    checks.push('Multiple previews attach only to main window, scale coordinates and release independently');

    const rectUpdates = operations.filter(op => op.id === 0 && op.method === 'setRect').length;
    main.emit('move');
    assert.ok(operations.filter(op => op.id === 0 && op.method === 'setRect').length > rectUpdates);
    assert.equal(await invoke(main, "require('electron').ipcRenderer.listenerCount('native-window:measure')"), 0);
    await invoke(main, `(async () => {
      const { observeNativeWindow } = await import(${JSON.stringify(devServerUrl ? new URL('components/NativePreview/nativeWindow.ts', devServerUrl).href : pathToFileURL(layoutFixture).href)});
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:10px;top:10px;width:20px;height:20px';
      document.body.append(host);
      let rect;
      const layout = observeNativeWindow(host, { setRect: value => { rect = value; } });
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      try {
        await frame();
        if (rect.x !== 10) throw new Error('Initial placeholder measurement missing');
        host.style.transform = 'translateX(30px)';
        layout.requestMeasure();
        await frame();
        if (rect.x !== 40 || rect.width !== 20) throw new Error('Position-only layout sync failed');
        layout.dispose();
        rect = null;
        layout.requestMeasure();
        await frame();
        if (rect !== null) throw new Error('Disposed observer still measures');
      } finally { layout.dispose(); host.remove(); }
    })()`);
    checks.push('Host movement refreshes cached bounds; placeholder supports explicit position-only sync without measure IPC');

    // Keep the test hidden while checking real remote calls and event callbacks.
    const originals = Object.fromEntries(['minimize', 'maximize', 'unmaximize', 'isMaximized'].map(key => [key, main[key]]));
    let maximized = false;
    let minimized = false;
    main.minimize = () => { minimized = true; };
    main.isMaximized = () => maximized;
    main.maximize = () => { maximized = true; main.emit('maximize'); };
    main.unmaximize = () => { maximized = false; main.emit('unmaximize'); };
    try {
      await invoke(main, "document.getElementById('window-minimize').click()");
      assert.equal(minimized, true);
      await invoke(main, "document.getElementById('window-maximize').click()");
      assert.equal(maximized, true);
      await waitFor(async () => await invoke(main, "document.getElementById('window-maximize').getAttribute('aria-pressed')") === 'true', 'Maximize icon did not update');
      await invoke(main, "document.getElementById('window-maximize').click()");
      assert.equal(maximized, false);
      await waitFor(async () => await invoke(main, "document.getElementById('window-maximize').getAttribute('aria-pressed')") === 'false', 'Restore icon did not update');
      assert.equal(await invoke(main, "typeof window.desktop.window"), 'undefined');
    } finally {
      Object.assign(main, originals);
    }
    checks.push('Title bar uses remote window methods and events without preload window API');

    await invoke(main, "document.getElementById('open-settings').click()");
    await waitFor(async () => childTarget.isVisible() && await invoke(childTarget, "document.querySelector('.settings-page') !== null"), 'Main settings entry did not open settings page');
    assert.equal(await loaded(childTarget, 'Settings'), true);
    assert.equal(await loaded(main, 'Settings'), false);
    const groups = await invoke(childTarget, "Array.from(document.querySelectorAll('.settings-navigation button'), button => ({ id: button.dataset.group, title: button.textContent }))");
    assert.deepEqual(groups.map(group => group.id), ['general', 'stream', 'video', 'audio']);
    for (const group of groups) {
      await invoke(childTarget, 'document.querySelector(' + JSON.stringify('[data-group="' + group.id + '"]') + ').click()');
      await waitFor(async () => await invoke(childTarget, "document.getElementById('settings-group-title').textContent") === group.title, 'Settings group did not switch');
    }
    assert.deepEqual(manager.list(), [{ key: 'preview', id: 0 }]);
    fs.writeFileSync(path.join(output, 'main.png'), (await main.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'settings.png'), (await childTarget.webContents.capturePage()).toPNG());
    checks.push('Main opens Settings and its four groups switch without creating native previews');

    const settingsWid = childTarget.id;
    await invoke(childTarget, "document.getElementById('business-close').click()");
    await waitFor(() => !childTarget.isVisible(), 'Settings close button did not hide child');
    await call(main, 'showWindow', { page: 'Settings', reuse: true, title: 'Settings' });
    await waitFor(() => childTarget.isVisible(), 'Settings did not reopen');
    assert.equal(childTarget.id, settingsWid);
    assert.equal(await invoke(childTarget, "document.querySelector('[data-group=audio]').getAttribute('aria-pressed')"), 'true');
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    await call(main, 'closeWindow', 'child');
    const childLoaded = once(childTarget.webContents, 'did-finish-load');
    childTarget.reload();
    await childLoaded;
    await waitFor(() => invoke(childTarget, "document.querySelector('.settings-page') !== null"), 'Settings did not render after reload');
    assert.equal(childTarget.isVisible(), false);
    await call(main, 'showWindow', { page: 'Settings', reuse: true, title: 'Settings' });
    await waitFor(() => childTarget.isVisible(), 'Reloaded Settings did not reopen');
    assert.deepEqual(manager.list(), [{ key: 'preview', id: 0 }]);
    checks.push('Settings close/reopen reuses its window and preserves group; hidden reload stays hidden');

    if (devServerUrl) {
      await call(main, 'showWindow', { page: 'Settings', reuse: true, title: 'Hot update' });
      await waitFor(() => displayed(childTarget, 'Settings'), 'Settings not mounted for hot update');
      await invoke(childTarget, "window.__hmrMarker = 'preserved'");
      const componentFile = path.join(root, 'electron/src/app/pages/Settings.tsx');
      const original = fs.readFileSync(componentFile, 'utf8');
      try {
        fs.writeFileSync(componentFile, original.replace('<p className=', '<p data-hmr="updated" className='));
        await waitFor(async () => await invoke(childTarget, "document.querySelector('[data-hmr=updated]') !== null"), 'React Fast Refresh did not update the component');
        assert.equal(await invoke(childTarget, 'window.__hmrMarker'), 'preserved');
      } finally {
        // Separate the restore write from the watcher debounce interval.
        await new Promise(resolve => setTimeout(resolve, 250));
        fs.writeFileSync(componentFile, original);
      }
      await waitFor(async () => await invoke(childTarget, "document.querySelector('[data-hmr=updated]') === null"), 'Restored component did not refresh');
      checks.push('Vite React Fast Refresh updates component without reloading the window');

      // A non-component dependency invalidates both page entries and reloads them.
      // Verify the recreated React tree owns fresh remote proxies and layout observers.
      const serviceFile = path.join(root, 'electron/src/app/services/windows.ts');
      const originalService = fs.readFileSync(serviceFile, 'utf8');
      let mainLoads = 0;
      let childLoads = 0;
      const onMainLoad = () => { ++mainLoads; };
      const onChildLoad = () => { ++childLoads; };
      main.webContents.on('did-finish-load', onMainLoad);
      childTarget.webContents.on('did-finish-load', onChildLoad);
      const traceCleanups = [];
      for (const [id, window] of [['main', main], ['child', childTarget]]) {
        for (const name of ['did-start-navigation', 'will-navigate', 'did-navigate', 'did-finish-load', 'will-prevent-unload']) {
          const listener = (event, ...args) => {
            navigationTrace.push({
              at: new Date().toISOString(), window: id, event: name,
              defaultPrevented: event?.defaultPrevented ?? false,
              url: event?.url ?? args.find(arg => typeof arg === 'string') ?? window.webContents.getURL(),
            });
          };
          window.webContents.on(name, listener);
          traceCleanups.push(() => window.webContents.removeListener(name, listener));
        }
      }
      const waitForReloadedPreview = async (previousMainLoads, previousChildLoads, previousAttaches) => {
        await waitFor(() => mainLoads > previousMainLoads && childLoads > previousChildLoads,
          'Vite dependency update did not finish reloading both pages');
        await waitFor(async () => mainWindow.ready &&
          await invoke(main, "document.getElementById('native-window-host') !== null") &&
          await invoke(childTarget, "document.querySelector('.settings-page') !== null"),
        'Vite full reload did not remount the page trees');
        await waitFor(() => operations.filter(op => op.id === 0 && op.method === 'attach').length > previousAttaches,
          'Vite full reload did not recreate the main preview');
        const layouts = operations.filter(op => op.id === 0 && op.method === 'setRect').length;
        await invoke(main, "window.dispatchEvent(new Event('resize'))");
        await waitFor(() => operations.filter(op => op.id === 0 && op.method === 'setRect').length > layouts,
          'Preview layout observer retained an invalid remote proxy after Vite full reload');
        assert.deepEqual(manager.list(), [{ key: 'preview', id: 0 }]);
        assert.deepEqual(errors, []);
      };
      try {
        const beforeUpdate = [mainLoads, childLoads,
          operations.filter(op => op.id === 0 && op.method === 'attach').length];
        try {
          navigationTrace.push({ at: new Date().toISOString(), event: 'write-service-update' });
          fs.writeFileSync(serviceFile, originalService + '\n// Full reload regression probe.\n');
          await waitForReloadedPreview(...beforeUpdate);
        } finally {
          await new Promise(resolve => setTimeout(resolve, 250));
          navigationTrace.push({ at: new Date().toISOString(), event: 'restore-service-source' });
          fs.writeFileSync(serviceFile, originalService);
        }
        const beforeRestore = [mainLoads, childLoads,
          operations.filter(op => op.id === 0 && op.method === 'attach').length];
        await waitForReloadedPreview(...beforeRestore);
        checks.push('Vite dependency full reload restores both pages and native preview layout without stale remote proxies');
      } finally {
        main.webContents.removeListener('did-finish-load', onMainLoad);
        childTarget.webContents.removeListener('did-finish-load', onChildLoad);
        for (const cleanup of traceCleanups) cleanup();
      }
    }

    childTarget.close();
    await waitFor(() => !childTarget.isVisible(), 'Child close did not hide window');
    assert.equal(childTarget.isDestroyed(), false);
    checks.push('Child OS close hides without destruction or page synchronization');

    // Keep A pending so B arrives while the claimed child has not rendered or shown.
    const originalChildLoad = childTarget.loadURL;
    let releaseChildLoad;
    childTarget.loadURL = function (...args) {
      return new Promise((resolve, reject) => {
        releaseChildLoad = () => { originalChildLoad.apply(this, args).then(resolve, reject); };
      });
    };
    const openingA = call(main, 'showWindow',
      { page: 'Settings', reuse: true, id: 'reuse:a', title: 'Reusable A' });
    let reuseB;
    try {
      await waitFor(() => releaseChildLoad !== undefined, 'Child A did not start loading');
      assert.equal(childTarget.isVisible(), false);
      assert.equal(windowManager.find('reuse:a'), 'child');
      reuseB = await call(main, 'showWindow',
        { page: 'Settings', reuse: true, id: 'reuse:b', title: 'Reusable B' });
      assert.notEqual(reuseB, 'child');
      assert.equal(windowManager.find('reuse:b'), reuseB);
      assert.equal(childTarget.isVisible(), false);
    } finally {
      childTarget.loadURL = originalChildLoad;
      releaseChildLoad?.();
    }
    const reuseA = await openingA;
    assert.equal(reuseA, 'child');
    const fallbackB = BrowserWindow.fromId(state(reuseB).wid);
    await waitFor(async () => childTarget.isVisible() && fallbackB.isVisible() &&
      await displayed(childTarget, 'Reusable A'), 'Concurrent reusable windows did not show');
    assert.equal(fallbackB.getParentWindow(), main);
    const boundsA = childTarget.getBounds();
    await invoke(childTarget, "window.__reuseMarker = 'A'; document.querySelector('[data-group=audio]').click()");
    await waitFor(() => invoke(childTarget, "document.querySelector('[data-group=audio]').getAttribute('aria-pressed') === 'true'"),
      'Reusable A did not preserve its selected group');
    assert.equal(await call(main, 'showWindow',
      { page: 'Settings', reuse: true, id: 'reuse:a', title: 'Do not replace A', size: { width: 420, height: 360 } }), reuseA);
    assert.equal(await invoke(childTarget, 'window.__reuseMarker'), 'A');
    assert.equal(await invoke(childTarget, "document.querySelector('[data-group=audio]').getAttribute('aria-pressed')"), 'true');
    assert.equal(childTarget.getTitle(), 'Reusable A');
    assert.deepEqual(childTarget.getBounds(), boundsA);
    assert.equal(windowManager.list().length, 3);
    checks.push('Concurrent reusable requests reserve child before ready and fall back to one-off; repeated business keeps its state');

    await call(main, 'closeWindow', 'reuse:a');
    assert.equal(windowManager.find('reuse:a'), null);
    assert.equal(await call(main, 'showWindow',
      { page: 'Settings', reuse: true, id: 'reuse:b', title: 'Do not migrate B' }), reuseB);
    assert.equal(state(reuseB).wid, fallbackB.id);
    assert.equal(fallbackB.getTitle(), 'Reusable B');
    assert.equal(childTarget.isVisible(), false);
    const reuseC = await call(main, 'showWindow',
      { page: 'Settings', reuse: true, id: 'reuse:c', title: 'Reusable C' });
    assert.equal(reuseC, 'child');
    await waitFor(() => displayed(childTarget, 'Reusable C'), 'Freed child did not load C');
    assert.equal(childTarget.id, settingsWid);
    assert.equal(await invoke(childTarget, 'window.__reuseMarker'), undefined);
    assert.equal(await invoke(childTarget, "document.querySelector('[data-group=general]').getAttribute('aria-pressed')"), 'true');
    checks.push('Existing fallback keeps its window when child becomes free; a new business reuses child with fresh page state');

    const reuseNavigation = once(main.webContents, 'did-start-navigation');
    main.reload();
    await reuseNavigation;
    assert.equal(await call(fallbackB, 'showWindow',
      { page: 'Settings', reuse: true, id: 'reuse:c', title: 'Do not replace C' }), 'child');
    assert.equal(await call(fallbackB, 'showWindow', { page: 'Settings', reuse: true, id: 'reuse:b' }), reuseB);
    assert.equal(windowManager.find('reuse:c'), 'child');
    assert.equal(childTarget.getTitle(), 'Reusable C');
    const reuseD = await call(main, 'showWindow', { page: 'Settings', reuse: true, id: 'reuse:d' });
    assert.notEqual(reuseD, 'child');
    assert.equal(windowManager.list().length, 4);
    await call(main, 'closeAllWindow');
    assert.equal(childTarget.isVisible(), false);
    for (const id of ['reuse:a', 'reuse:b', 'reuse:c', 'reuse:d']) assert.equal(windowManager.find(id), null);
    assert.deepEqual(windowManager.list().map(item => item.id).sort(), ['child', 'main']);
    checks.push('Main reload retains child ownership and fallback identities; closeAllWindow releases every business');

    assert.equal(await call(main, 'showWindow', { page: 'Test', reuse: true }), 'child');
    await waitFor(() => invoke(childTarget, "document.querySelector('.settings-page') !== null"), 'Alternate page did not render');
    assert.equal(new URL(childTarget.webContents.getURL()).searchParams.get('fixture'), 'another-page');
    await call(main, 'closeWindow', 'child');
    assert.equal(await call(main, 'showWindow', { page: 'Settings', reuse: true }), 'child');
    assert.equal(new URL(childTarget.webContents.getURL()).searchParams.has('fixture'), false);
    await call(main, 'closeWindow', 'child');
    checks.push('Idle child loads the requested page URL and switches back without creating another preloaded window');

    // A failed navigation must release the slot and allow retrying the same business.
    childTarget.loadURL = () => Promise.reject(new Error('Intentional child load failure'));
    try {
      await assert.rejects(call(main, 'showWindow',
        { page: 'Settings', reuse: true, id: 'reuse:failed' }), /Intentional child load failure/);
    } finally {
      childTarget.loadURL = originalChildLoad;
    }
    assert.equal(windowManager.find('reuse:failed'), null);
    assert.equal(childTarget.isVisible(), false);
    assert.equal(await call(main, 'showWindow', { page: 'Settings', reuse: true, id: 'reuse:failed' }), 'child');
    await waitFor(() => childTarget.isVisible(), 'Child did not recover after failed load');
    await call(main, 'closeWindow', 'child');
    checks.push('Failed child load releases its claim and retrying the same business loads again');

    const sourceId = await call(main, 'showWindow',
      { page: 'Settings', reuse: false, id: 'source:camera-1', title: 'Independent properties' });
    const source = BrowserWindow.fromId(state(sourceId).wid);
    await waitFor(() => source.isVisible(), 'One-off not mounted');
    assert.equal(new URL(source.webContents.getURL()).pathname.endsWith('/settings.html'), true);
    assert.equal(source.getParentWindow(), main);
    const originalSourceId = source.id;
    await call(main, 'showWindow', { page: 'Settings', reuse: false, id: sourceId });
    assert.equal(state(sourceId).wid, originalSourceId);
    assert.equal(source.getTitle(), 'Independent properties');
    const projectorA = await call(main, 'showWindow', { page: 'Settings', reuse: false });
    const projectorB = await call(main, 'showWindow', { page: 'Settings' });
    assert.notEqual(projectorA, projectorB);
    assert.equal(windowManager.list().length, 5);
    checks.push('Named one-off reuses identity without replacing content; omitted IDs create independent windows');

    await call(source, 'showWindow', { page: 'Settings', reuse: true, title: 'From one-off' });
    await waitFor(async () => childTarget.isVisible() && await displayed(childTarget, 'From one-off'), 'Cross-window service routing failed');
    assert.deepEqual(await invoke(source, "require('@electron/remote').getGlobal('nativeWindowMgr').list()"), manager.list());
    await invoke(source, "require('@electron/remote').getGlobal('nativeWindowMgr').setVisible('preview', false)");
    assert.equal(operations.at(-1).method, 'detach');
    await invoke(source, "require('@electron/remote').getGlobal('nativeWindowMgr').setVisible('preview', true)");
    assert.equal(operations.at(-1).method, 'attach');
    checks.push('One-off requests execute in main renderer; native manager is shared across renderers');

    const beforeReload = manager.list();
    const sourceLoaded = once(source.webContents, 'did-finish-load');
    source.reload();
    await sourceLoaded;
    await waitFor(async () => await invoke(source, "document.querySelector('.settings-page') !== null") && await displayed(source, 'Independent properties'), 'One-off reload did not restore saved component');
    assert.deepEqual(manager.list(), beforeReload);
    checks.push('One-off reload restores its page without touching main preview');

    const mainAttaches = operations.filter(op => op.id === 0 && op.method === 'attach').length;
    const navigation = once(main.webContents, 'did-start-navigation');
    main.reload();
    await navigation;
    await call(source, 'showWindow', { page: 'Settings', reuse: true, title: 'After main reload' });
    await waitFor(async () => mainWindow.ready && await displayed(childTarget, 'From one-off'), 'Main service did not recover');
    assert.equal(state(sourceId).wid, originalSourceId);
    assert.equal(windowManager.list().length, 5);
    await call(main, 'showWindow', { page: 'Settings', reuse: false, id: sourceId });
    assert.equal(state(sourceId).wid, originalSourceId);
    await waitFor(() => operations.filter(op => op.id === 0 && op.method === 'attach').length > mainAttaches, 'Main reload did not recreate preview');
    checks.push('Main renderer reload restores preview, rebuilds proxies and drains queued requests');

    source.close();
    await waitFor(() => !state(sourceId), 'One-off close leaked resources');
    assert.equal(source.isDestroyed(), true);
    const invalid = await invoke(main,
      "require('electron').ipcRenderer.invoke('windows:request', 'showWindow', [{page:'Missing'}]).then(() => '', e => e.message)");
    assert.match(invalid, /Unknown window page/);
    assert.deepEqual(manager.list(), [{ key: 'preview', id: 0 }]);
    checks.push('One-off close removes registration without touching main preview; unknown components are rejected');

    const oldPid = mediaService.child.pid;
    const statusEvents = [];
    const unsubscribeStatus = mediaService.onStatus(status => statusEvents.push(status));
    let removedListenerCalls = 0;
    const unsubscribeRemoved = mediaService.onStatus(() => { ++removedListenerCalls; });
    unsubscribeRemoved();
    mediaService.child.kill();
    await waitFor(() => mediaService.child === null, 'Service did not exit');
    await waitFor(async () => await invoke(main, "!document.getElementById('connection-dot').classList.contains('online')"), 'Disconnected state not pushed to main page');
    const attaches = operations.filter(op => op.method === 'attach').length;
    assert.equal(await mediaService.ensureConnected(), true);
    assert.notEqual(mediaService.child.pid, oldPid);
    await waitFor(() => operations.filter(op => op.method === 'attach').length > attaches, 'Native previews not restored');
    await waitFor(async () => await invoke(main, "document.getElementById('connection-dot').classList.contains('online')"), 'Connected state not pushed to main page');
    assert.ok(statusEvents.some(status => !status.connected));
    assert.equal(statusEvents.at(-1).connected, true);
    assert.equal(removedListenerCalls, 0);
    unsubscribeStatus();
    const statusCount = statusEvents.length;
    checks.push('Media service restart restores surviving previews');
    checks.push('Media status subscriptions update main page after reload and support unsubscription');

    await call(main, 'closeWindow', projectorA);
    assert.equal(state(projectorA), undefined);
    await assert.rejects(call(main, 'closeWindow', 'main'), /Invalid business window ID/);
    await call(main, 'closeAllWindow');
    assert.equal(childTarget.isVisible(), false);
    assert.equal(childTarget.isDestroyed(), false);
    assert.deepEqual(windowManager.list().map(item => item.id).sort(), ['child', 'main']);
    assert.deepEqual(errors, []);
    checks.push('closeWindow destroys one-off and protects main; closeAllWindow hides child and destroys remaining one-offs');
    app.once('will-quit', () => {
      try {
        assert.equal(manager.list().length, 0);
        assert.equal(statusEvents.length, statusCount);
        assert.deepEqual(errors, []);
        checks.push('Application shutdown disposes windows and native resources');
        finished = true;
        clearTimeout(watchdog);
        report();
      } catch (error) { report(error); process.exitCode = 1; }
    });
    await invoke(main, "setTimeout(() => document.getElementById('window-close').click(), 0); undefined");
  } catch (error) { await fail(error); }
}

void app.whenReady().then(run).catch(fail);
