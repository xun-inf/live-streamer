import { createRequire } from 'node:module';

export interface TextureHandleApi {
  duplicate(processId: number, handle: bigint): Buffer;
  close(handle: Buffer): void;
}

export function loadTextureHandle(modulePath: string): TextureHandleApi {
  return createRequire(import.meta.url)(modulePath) as TextureHandleApi;
}
