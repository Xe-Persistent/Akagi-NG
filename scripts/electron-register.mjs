import { register } from 'node:module';

register('./electron-loader.mjs', import.meta.url);
