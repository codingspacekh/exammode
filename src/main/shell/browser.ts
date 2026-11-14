/**
 * The exam browser (F-10, F-13, architecture §2.6): a window of its own, only when the exam has websites. Its top
 * strip (tabs, back, forward, the address shown but not typed) is one of ExamMode's screens; each tab's page is a
 * view under it, in a partition of its own that is wiped at the end. Every request is asked of `decide()`
 * (src/lib/browser/sites.ts). Electron glue: proven by the e2e tests.
 */
import { BrowserWindow, WebContentsView, session, type Rectangle, type Session } from 'electron';
import type { BrowserState, BrowserTab } from '@lib/app/state';
import { allowsPage, decide, examSites, hostOf, type ExamSite, type Website } from '@lib/browser/sites';
import { createWindow } from './windows';

/** The height of the top strip: the tabs and the bar under them. */
const STRIP = 70;

interface Tab { id: number; view: WebContentsView; blocked?: string }

export class ExamBrowser {
  readonly window: BrowserWindow;
  private readonly sites: ExamSite[];
  private readonly session: Session;
  private readonly tabs: Tab[] = [];
  private active = 0;
  private nextId = 1;

  constructor(websites: Website[], bounds: Rectangle, private readonly events: { changed(state: BrowserState): void; blocked(url: string): void }) {
    this.sites = examSites(websites);
    // no `persist:` — nothing of the exam's browsing is kept on the lab computer
    this.session = session.fromPartition(`exam-${Date.now()}`);
    this.session.webRequest.onBeforeRequest((details, answer) => {
      const allow = decide({ url: details.url, type: details.resourceType }, this.sites) === 'allow';
      if (!allow && details.resourceType === 'mainFrame') this.block(this.tabs.find((t) => t.view.webContents.id === details.webContentsId), details.url);
      answer({ cancel: !allow });
    });
    this.session.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    this.session.on('will-download', (event) => event.preventDefault());

    this.window = createWindow('browser', { ...bounds, frame: false, resizable: false, movable: false, minimizable: false, title: 'ExamMode — the exam\'s websites' });
    this.window.on('resize', () => this.layout());
    this.window.once('ready-to-show', () => this.window.show());
    const first = this.sites[0];
    if (first) this.open(first.rule.start);
  }

  state(): BrowserState {
    return { tabs: this.tabs.map((t) => this.describe(t)), active: this.active, sites: this.sites.map((s) => (s.rule.whole ? s.rule.host : `${s.rule.host}${s.rule.path}`)) };
  }

  select(id: number): void {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.active = id;
    this.layout();
  }

  close(id: number): void {
    const at = this.tabs.findIndex((t) => t.id === id);
    if (at < 0 || this.tabs.length === 1) return;
    const [tab] = this.tabs.splice(at, 1);
    this.window.contentView.removeChildView(tab!.view);
    tab!.view.webContents.close();
    if (this.active === id) this.active = this.tabs[Math.max(0, at - 1)]!.id;
    this.layout();
  }

  back(): void {
    this.go((tab) => tab.view.webContents.navigationHistory.goBack());
  }

  forward(): void {
    this.go((tab) => tab.view.webContents.navigationHistory.goForward());
  }

  reload(): void {
    this.go((tab) => tab.view.webContents.reload());
  }

  /** From *This page isn't part of the exam*: back to the questions. */
  toQuestions(): void {
    const first = this.sites[0];
    if (first) this.go((tab) => void tab.view.webContents.loadURL(first.rule.start));
  }

  /** The end of the exam: the window is gone, and so is everything the websites kept. */
  destroy(): void {
    for (const tab of this.tabs.splice(0)) tab.view.webContents.close();
    if (!this.window.isDestroyed()) this.window.destroy();
    void this.session.clearStorageData();
  }

  private open(url: string): void {
    const view = new WebContentsView({ webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
    const tab: Tab = { id: this.nextId++, view };
    this.tabs.push(tab);
    this.active = tab.id;
    this.window.contentView.addChildView(view);
    const contents = view.webContents;
    // a link that wants a window of its own is a new tab, if it is one of the exam's pages
    contents.setWindowOpenHandler(({ url: wanted }) => {
      if (this.sites.some((s) => allowsPage(s.rule, wanted))) this.open(wanted);
      else this.block(tab, wanted);
      return { action: 'deny' };
    });
    for (const event of ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading'] as const) {
      contents.on(event as 'did-stop-loading', () => this.changed());
    }
    this.layout();
    void contents.loadURL(url).catch(() => undefined);
  }

  /** The tab shows *This page isn't part of the exam*; the teacher's log gets a note (F-13). */
  private block(tab: Tab | undefined, url: string): void {
    if (!tab) return;
    tab.blocked = hostOf(url);
    this.events.blocked(url);
    this.layout();
  }

  private go(act: (tab: Tab) => void): void {
    const tab = this.tabs.find((t) => t.id === this.active);
    if (!tab) return;
    tab.blocked = undefined;
    act(tab);
    this.layout();
  }

  /** Only the tab in front is shown, under the strip; a blocked one gives its place to ExamMode's own message. */
  private layout(): void {
    if (this.window.isDestroyed()) return;
    const [width = 0, height = 0] = this.window.getContentSize();
    for (const tab of this.tabs) {
      tab.view.setBounds({ x: 0, y: STRIP, width, height: Math.max(0, height - STRIP) });
      tab.view.setVisible(tab.id === this.active && !tab.blocked);
    }
    this.changed();
  }

  private describe(tab: Tab): BrowserTab {
    const contents = tab.view.webContents;
    return {
      id: tab.id, title: contents.getTitle() || hostOf(contents.getURL()), url: contents.getURL(), loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), blocked: tab.blocked,
    };
  }

  private changed(): void {
    this.events.changed(this.state());
  }
}
