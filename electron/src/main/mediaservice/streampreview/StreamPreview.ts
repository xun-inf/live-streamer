import { sharedTexture, type WebContents } from 'electron';
import { logger } from '../../logger.js';
import { loadTextureHandle, type TextureHandleApi } from './TextureHandle.js';

interface Binding {
  target: WebContents;
  dispose(): void;
}

export interface SharedVideoFrame {
  id: number;
  token: bigint;
  handle: bigint;
  width: number;
  height: number;
  timestamp: number;
}

// 所有调用在 main 线程；一个 presenter 当前只绑定一个页面。
export class StreamPreview {
  private readonly bindings = new Map<number, Binding>();
  private handles: TextureHandleApi | null = null;
  private processId = 0;
  private generation = 0;
  private releaseHandler: ((id: number) => void) | null = null;

  constructor(private readonly modulePath: () => string) {}

  setReleaseHandler(handler: (id: number) => void): void {
    this.releaseHandler = handler;
  }

  connectionChanged(processId: number): void {
    ++this.generation;
    this.processId = processId;
  }

  bind(id: number, target: WebContents): void {
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff || target.isDestroyed()) {
      throw new Error('Invalid stream preview binding');
    }
    const previous = this.bindings.get(id);
    if (previous?.target === target) return;
    if (previous) throw new Error('Stream preview already has a consumer');
    const dispose = (): void => { this.unbind(id, target); };
    const navigate = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) dispose();
    };
    this.bindings.set(id, { target, dispose: () => {
      target.off('destroyed', dispose);
      target.off('render-process-gone', dispose);
      target.off('did-start-navigation', navigate);
    } });
    target.once('destroyed', dispose);
    target.on('render-process-gone', dispose);
    target.on('did-start-navigation', navigate);
  }

  unbind(id: number, target: WebContents): void {
    const binding = this.bindings.get(id);
    if (binding?.target !== target) return;
    binding.dispose();
    this.bindings.delete(id);
    if (this.processId !== 0) this.releaseHandler?.(id);
  }

  stop(): void {
    this.connectionChanged(0);
    for (const binding of this.bindings.values()) binding.dispose();
    this.bindings.clear();
  }

  presentFrame(frame: SharedVideoFrame, onReleased: () => void): void {
    const generation = this.generation;
    const release = (): void => {
      if (generation === this.generation && this.processId !== 0) onReleased();
    };
    const target = this.bindings.get(frame.id)?.target;
    if (!target || target.isDestroyed() || this.processId === 0) {
      release();
      return;
    }
    let imported: Electron.SharedTextureImported | null = null;
    try {
      this.handles ??= loadTextureHandle(this.modulePath());
      const handle = this.handles.duplicate(this.processId, frame.handle);
      try {
        imported = sharedTexture.importSharedTexture({
          textureInfo: { handle: { ntHandle: handle }, pixelFormat: 'bgra',
            codedSize: { width: frame.width, height: frame.height }, timestamp: frame.timestamp },
          allReferencesReleased: release,
        });
      } finally {
        // Electron 导入时持有自己的副本。
        this.handles.close(handle);
      }
      const texture = imported;
      void sharedTexture.sendSharedTexture({ frame: target.mainFrame, importedSharedTexture: texture }, frame.id)
        .catch(error => { logger.error('video texture transfer failed:', error); })
        .finally(() => { texture.release(); });
    } catch (error) {
      if (imported) imported.release();
      else release();
      logger.error('video texture import failed:', error);
    }
  }
}
