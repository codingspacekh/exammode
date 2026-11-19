/** The exam browser's API (architecture §2.6): its tabs, and what its bar can ask for. Types only. */

export interface BrowserTab { id: number; title: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; /** the host of a page that isn't part of the exam (07b) */ blocked?: string }
export interface BrowserState { tabs: BrowserTab[]; active: number; sites: string[] }

export interface BrowserApi {
  get(): Promise<BrowserState>;
  onState(listener: (state: BrowserState) => void): () => void;
  select(tab: number): Promise<void>;
  close(tab: number): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  /** from *This page isn't part of the exam*: back to the questions */
  toQuestions(): Promise<void>;
}
