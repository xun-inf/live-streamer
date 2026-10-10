// Windows integration check: inspect real visible HWNDs instead of mocking attach/show.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { app } from 'electron';
import { mediaService } from '../dist/main/mediaService/index.js';
import { mainWindow } from '../dist/main/windows/mainWindow.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'build/native-preview-smoke');
const probeFile = path.join(root, 'electron/test/inspect-native-preview.ps1');
const executeFile = promisify(execFile);
const checks = [];
const samples = [];
const errors = [];
let finished = false;
let shuttingDown = false;

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'running' }));
app.setPath('userData', path.join(output, 'profile'));
app.setPath('sessionData', path.join(output, 'profile'));
process.argv.push('--devtools=0', '--media-service-exe=' + path.join(root, 'build/bin/Debug/media-service.exe'),
  '--main-log=' + path.join(output, 'main.log'), '--media-service-log=' + path.join(output, 'media-service.log'),
  '--pipe-name=\\\\.\\pipe\\native-preview-smoke-' + process.pid);

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('preload-error', (_event, _file, error) => errors.push(String(error)));
  window.webContents.on('console-message', details => {
    if (details.level === 'error') errors.push(details.message);
  });
});

function report(error) {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    status: error ? 'failed' : 'passed', checks, samples, errors, error: error?.stack,
  }, null, 2));
}

async function fail(error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  report(error);
  // Keep cleanup bounded even if an application shutdown handler stalls.
  setTimeout(() => app.exit(1), 8000);
  try { await mediaService.stop(); } finally { app.exit(1); }
}

const watchdog = setTimeout(() => { void fail(new Error('Native preview test timed out')); }, 60000);
app.on('will-quit', () => {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  if (!shuttingDown) {
    report(new Error('Application quit before native preview checks completed'));
    process.exitCode = 1;
    return;
  }
  checks.push('Closing main window shuts down the application and media-service');
  report();
});

async function waitFor(predicate, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function inspect(main, stage) {
  const bytes = main.getNativeWindowHandle();
  const owner = (bytes.length >= 8 ? bytes.readBigUInt64LE() : BigInt(bytes.readUInt32LE())).toString();
  let lastError;
  let sample;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const placeholder = await main.webContents.executeJavaScript(`(() => {
      const host = document.getElementById('native-window-host');
      if (!host) return null;
      const rect = host.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, dpr: window.devicePixelRatio };
    })()`);
    const { stdout } = await executeFile('powershell.exe', ['-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', probeFile, '-OwnerHandle', owner], { windowsHide: true, timeout: 10000 });
    const native = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    sample = { stage, placeholder, native };
    try {
      assert.ok(placeholder?.width > 0 && placeholder.height > 0, 'DOM preview placeholder is missing or empty');
      assert.equal(native.OwnerVisible, true, 'Electron owner HWND is hidden');
      assert.equal(native.Views.length, 1, 'Expected one NativeWindowView owned by this main HWND');
      const view = native.Views[0];
      assert.equal(view.Owner, owner);
      assert.equal(view.ProcessName.toLowerCase(), 'media-service');
      assert.notEqual(view.ProcessId, process.pid, 'Native preview must belong to media-service');
      assert.equal(view.Visible, true, 'Native preview HWND exists but is hidden');
      const left = native.ClientOrigin.X + Math.round(placeholder.x * placeholder.dpr);
      const top = native.ClientOrigin.Y + Math.round(placeholder.y * placeholder.dpr);
      sample.expectedBounds = {
        Left: left, Top: top,
        Right: left + Math.round(placeholder.width * placeholder.dpr),
        Bottom: top + Math.round(placeholder.height * placeholder.dpr),
      };
      assert.deepEqual(view.Bounds, sample.expectedBounds, 'Native preview bounds differ from DOM placeholder in physical pixels');
      samples.push(sample);
      checks.push(stage + ': native HWND is visible, owned by main, and matches DOM placeholder bounds');
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  samples.push(sample);
  throw lastError;
}

async function run() {
  assert.equal(process.platform, 'win32', 'This check requires Windows HWNDs');
  await import('../dist/main/main.js');
  await waitFor(() => mainWindow.ready && mediaService.connected,
    'Main window/service did not become ready');
  const main = mainWindow.target;
  // The launching PowerShell may specify SW_HIDE in STARTUPINFO; perform an
  // explicit show after startup instead of trusting ready-to-show alone.
  main.show();
  await waitFor(() => main.isVisible(), 'Main window did not become visible');
  await inspect(main, 'Initial load');
  const loaded = once(main.webContents, 'did-finish-load');
  await main.webContents.executeJavaScript('setTimeout(() => location.reload(), 0); undefined');
  await loaded;
  await inspect(main, 'Renderer reload');
  assert.deepEqual(errors, [], 'Renderer/preload errors were reported');
  shuttingDown = true;
  main.close();
}

run().catch(fail);
