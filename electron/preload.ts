import { contextBridge, ipcRenderer } from 'electron';
import type { ReaderApi, BossState } from '../src/shared/api';
import type { Prefs, Progress } from '../src/shared/types';

export const api = {
  image: {
    pick: () => ipcRenderer.invoke('image:pick'),
    data: (path: string) => ipcRenderer.invoke('image:data', path),
    book: (bookId: string, file: string) => ipcRenderer.invoke('image:book', bookId, file),
  },
  pdf: {
    read: (bookId: string) => ipcRenderer.invoke('pdf:read', bookId),
    savePageCount: (bookId: string, pageCount: number) =>
      ipcRenderer.invoke('pdf:save-page-count', bookId, pageCount),
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    importViaDialog: () => ipcRenderer.invoke('library:import-dialog'),
    importBytes: (fileName: string, data: ArrayBuffer, sourcePath: string | null = null) =>
      ipcRenderer.invoke('library:import-bytes', fileName, data, sourcePath),
    remove: (id: string) => ipcRenderer.invoke('library:remove', id),
    open: (id: string) => ipcRenderer.invoke('library:open', id),
  },
  progress: {
    get: (bookId: string) => ipcRenderer.invoke('progress:get', bookId),
    set: (progress: Progress) => ipcRenderer.invoke('progress:set', progress),
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch: Partial<Prefs>) => ipcRenderer.invoke('prefs:set', patch),
  },
  bookmarks: {
    list: (bookId: string) => ipcRenderer.invoke('bookmarks:list', bookId),
    add: (input: { bookId: string; offset: number; chapterTitle: string; excerpt: string }) =>
      ipcRenderer.invoke('bookmarks:add', input),
    remove: (bookId: string, id: string) => ipcRenderer.invoke('bookmarks:remove', bookId, id),
  },
  stats: {
    summary: (windowDays?: number) => ipcRenderer.invoke('stats:summary', windowDays),
    addSession: (session: { bookId: string; startedAt: number; seconds: number }) =>
      ipcRenderer.invoke('stats:add', session),
    clear: () => ipcRenderer.invoke('stats:clear'),
  },
  window: {
    getState: () => ipcRenderer.invoke('window:get-state'),
    toggleBoss: (on?: boolean) => ipcRenderer.invoke('window:toggle-boss', on),
    setBossTint: (value: number) => ipcRenderer.invoke('window:set-boss-tint', value),
    setHotkey: (accelerator: string) => ipcRenderer.invoke('window:set-hotkey', accelerator),
    onBossChanged: (callback: (state: BossState) => void) => {
      const listener = (_event: unknown, state: BossState) => callback(state);
      ipcRenderer.on('boss:changed', listener);
      return () => {
        ipcRenderer.removeListener('boss:changed', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('reader', api);
