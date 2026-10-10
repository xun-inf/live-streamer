import { mountApp } from '../app';
import { Main } from '../pages/Main';

const dispose = mountApp(<Main />, true);
if (import.meta.hot) import.meta.hot.dispose(dispose);
