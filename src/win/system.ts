/**
 * A real lab computer as the Guard's `System` (architecture §2.4): each kind of journal entry, read and changed
 * through Windows. The same reads and changes are made on plain data in src/lib/lockdown/journal.ts; the windows
 * tests hold the two together (T6, T7).
 */
import type { Change, FirewallProfile, JournalEntry } from '@lib/lockdown/journal';
import type { System } from '../guard/guard';
import { explorerRunning, startExplorer, stopExplorer } from './explorer';
import { Firewall } from './firewall';
import { readValue, writeValue } from './registry';

export class WindowsSystem implements System {
  private readonly firewall = new Firewall();

  async read(target: Pick<Change, 'kind' | 'target'>): Promise<JournalEntry['before']> {
    switch (target.kind) {
      case 'registry': return readValue(target.target);
      // our own rules, by our own names: one that is there is a leftover of ours, and counts as not there
      case 'firewallRule': return null;
      case 'firewallState': return (await this.firewall.profile(target.target as FirewallProfile)).state;
      case 'firewallOutbound': return (await this.firewall.profile(target.target as FirewallProfile)).outbound;
      case 'explorer': return (await explorerRunning()) ? 'running' : 'stopped';
    }
  }

  async apply(change: Change): Promise<void> {
    switch (change.kind) {
      case 'registry': return writeValue(change.target, change.after);
      case 'firewallRule': return change.after ? this.firewall.addRule(change.after) : this.firewall.deleteRule(change.target);
      case 'firewallState': return this.firewall.setState(change.target, change.after);
      case 'firewallOutbound': return this.firewall.setOutbound(change.target, change.after);
      case 'explorer': return change.after === 'stopped' ? stopExplorer() : startExplorer();
    }
  }
}
