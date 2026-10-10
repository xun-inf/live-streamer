import { useEffect, useState } from 'react';

const currentWindow = window.require('@electron/remote').getCurrentWindow();
const minimize = () => currentWindow.minimize();
const maximize = () => currentWindow.maximize();
const unmaximize = () => currentWindow.unmaximize();
const toggleMaximize = () => currentWindow.isMaximized() ? unmaximize() : maximize();
const close = () => currentWindow.close();

export function useWindowControls() {
  const [maximized, setMaximized] = useState(() => currentWindow.isMaximized());
  useEffect(() => {
    let disposed = false;
    const update = () => { if (!disposed) setMaximized(currentWindow.isMaximized()); };
    currentWindow.on('maximize', update);
    currentWindow.on('unmaximize', update);
    update();
    return () => {
      disposed = true;
      currentWindow.removeListener('maximize', update);
      currentWindow.removeListener('unmaximize', update);
    };
  }, []);
  return { maximized, minimize, maximize, unmaximize, toggleMaximize, close };
}
