import type { HistoryPort } from './browser-history';

/** Browser actions execute only in the extension, never in QuickJS. */
export interface BrowserActionAPI extends HistoryPort {
  windows?: {
    getAll(options: { populate: false }): Promise<
      {
        id?: number | undefined;
        focused?: boolean | undefined;
        incognito?: boolean | undefined;
        type?: string | undefined;
        state?: string | undefined;
      }[]
    >;
    create?(options: Record<string, unknown>): Promise<unknown>;
    update?(id: number, options: Record<string, unknown>): Promise<unknown>;
  };
  tabs: {
    get(id: number): Promise<{
      title?: string | undefined;
      url?: string | undefined;
      windowId?: number | undefined;
      groupId?: number | undefined;
      status?: 'loading' | 'complete' | 'unloaded' | undefined;
    }>;
    create?: (options: { url?: string; active?: boolean }) => Promise<{
      id?: number | undefined;
      title?: string | undefined;
      url?: string | undefined;
    }>;
    remove?: (id: number) => Promise<void>;
    move?: (
      id: number,
      options: { index: number; windowId?: number },
    ) => Promise<{
      id?: number | undefined;
      windowId?: number | undefined;
      index?: number | undefined;
    }>;
    update?: (
      id: number,
      options: { active: boolean },
    ) => Promise<{ id?: number | undefined; active?: boolean | undefined }>;
    query?: (query: { active: boolean; windowId?: number }) => Promise<
      {
        id?: number | undefined;
        title?: string | undefined;
        url?: string | undefined;
      }[]
    >;
    group?: (options: {
      tabIds: number | [number, ...number[]];
      groupId?: number;
    }) => Promise<number>;
    ungroup?: (tabIds: number | number[]) => Promise<void>;
    sendMessage?: (id: number, message: unknown) => Promise<unknown>;
  };
  tabGroups?: {
    get?(id: number): Promise<unknown>;
    query?(query: Record<string, unknown>): Promise<unknown>;
    update: (
      id: number,
      options: {
        title?: string;
        color?:
          | 'blue'
          | 'cyan'
          | 'green'
          | 'orange'
          | 'pink'
          | 'purple'
          | 'red'
          | 'yellow'
          | 'grey';
      },
    ) => Promise<unknown>;
    move?(id: number, options: Record<string, unknown>): Promise<unknown>;
  };
  bookmarks?: {
    search(query: string | Record<string, unknown>): Promise<unknown>;
    getTree(): Promise<unknown>;
    create(details: Record<string, unknown>): Promise<unknown>;
    update(id: string, changes: Record<string, unknown>): Promise<unknown>;
    move(id: string, destination: Record<string, unknown>): Promise<unknown>;
    remove(id: string): Promise<void>;
  };
  downloads?: {
    download(options: {
      url: string;
      filename?: string;
      saveAs?: boolean;
      conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
    }): Promise<number>;
    search(query: { id?: number; limit?: number }): Promise<
      {
        id: number;
        url: string;
        filename: string;
        state: 'in_progress' | 'interrupted' | 'complete';
        tabId?: number | undefined;
        error?: string | undefined;
      }[]
    >;
    removeFile?(id: number): Promise<void>;
  };
  clipboard?: {
    read?(): Promise<
      {
        entries: { mimeType: string; text?: string; base64?: string }[];
        presentationStyle?: string;
      }[]
    >;
    readText?(): Promise<string>;
    write?(
      items: {
        entries: { mimeType: string; text?: string; base64?: string }[];
        presentationStyle?: string;
      }[],
    ): Promise<void>;
    writeText?(text: string): Promise<void>;
  };
  storage?: {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
  };
  scripting: {
    executeScript(details: {
      target: { tabId: number };
      func: () => { title: string; url: string; text: string };
    }): Promise<{ result?: { title: string; url: string; text: string } }[]>;
  };
}
