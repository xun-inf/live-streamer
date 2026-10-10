import { mountApp } from '../app';
import { SecondScreen } from '../pages/SecondScreen';

const dispose = mountApp(<SecondScreen />);
if (import.meta.hot) import.meta.hot.dispose(dispose);
