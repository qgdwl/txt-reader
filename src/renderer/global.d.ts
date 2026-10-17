import type { ReaderApi } from '../shared/api';

declare global {
  interface Window {
    reader: ReaderApi;
  }
}

export {};
