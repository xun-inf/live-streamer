import { mountApp } from '../app';
import { Settings } from '../pages/Settings';

const dispose = mountApp(<Settings />);
if (import.meta.hot) import.meta.hot.dispose(dispose);
