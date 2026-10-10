import { useEffect, useState } from 'react';

export function useMediaStatus() {
  const [status, setStatus] = useState({ connected: false, message: '连接中…' });
  useEffect(() => {
    let disposed = false;
    let received = false;
    const unsubscribe = window.desktop.mediaService.onStatus(value => {
      received = true;
      if (!disposed) setStatus(value);
    });
    window.desktop.mediaService.getStatus().then(value => {
      if (!disposed && !received) setStatus(value);
    }).catch(error => {
      if (disposed || received) return;
      setStatus({ connected: false, message: '读取连接状态失败' });
      console.error('读取连接状态失败:', error);
    });
    return () => { disposed = true; unsubscribe(); };
  }, []);
  return status;
}
