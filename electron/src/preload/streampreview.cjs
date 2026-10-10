const { ipcRenderer, sharedTexture } = require('electron');

const consumers = new Map();

sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, id) => {
  let frame;
  try {
    const consume = consumers.get(id);
    if (!consume) return;
    frame = importedSharedTexture.getVideoFrame();
    consume(frame);
    frame = null; // 消费者负责关闭接收的 VideoFrame。
  } finally {
    frame?.close();
    importedSharedTexture.release();
  }
});

function subscription(prefix) {
  return async (id, consume) => {
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff || typeof consume !== 'function') {
      throw new Error('Invalid stream preview subscription');
    }
    if (consumers.has(id)) throw new Error('Stream preview already has a consumer');
    consumers.set(id, consume);
    try {
      await ipcRenderer.invoke(prefix + ':bind', id);
    } catch (error) {
      consumers.delete(id);
      throw error;
    }
    let unsubscribing;
    return () => {
      if (!unsubscribing) {
        consumers.delete(id);
        unsubscribing = ipcRenderer.invoke(prefix + ':unbind', id);
      }
      return unsubscribing;
    };
  };
}

window.streamPreview = {
  subscribe: subscription('streamPreview'),
};
