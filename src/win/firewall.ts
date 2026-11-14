/**
 * Windows Defender Firewall for the lockdown (architecture §2.6, D8): our own rules by name, and each profile's
 * state and default for outbound traffic. Reading goes through PowerShell once for all three profiles (it gives
 * the values in force, in English on any Windows); changing goes through netsh, which takes a fraction of the time
 * (M0, finding 4).
 */
import type { FirewallProfile, FirewallRule } from '@lib/lockdown/journal';
import { expandEnv, powershellJson, run } from './run';

interface Profile { state: 'on' | 'off'; outbound: 'allow' | 'block'; inbound: string }
const NAME: Record<string, FirewallProfile> = { Domain: 'domain', Private: 'private', Public: 'public' };
const netsh = (...args: string[]) => run('netsh.exe', ['advfirewall', ...args]);

export class Firewall {
  private profiles?: { at: number; values: Record<FirewallProfile, Profile> };

  /** The three profiles as they are in force. Read once and remembered for a few seconds: a lock asks six times. */
  async profile(name: FirewallProfile): Promise<Profile> {
    if (!this.profiles || Date.now() - this.profiles.at > 30_000) {
      type Row = { Name: string; On: string; Out: string; In: string };
      const rows = await powershellJson<Row[] | Row>('Get-NetFirewallProfile -PolicyStore ActiveStore | Select-Object Name,@{n="On";e={"$($_.Enabled)"}},@{n="Out";e={"$($_.DefaultOutboundAction)"}},@{n="In";e={"$($_.DefaultInboundAction)"}}');
      const values = {} as Record<FirewallProfile, Profile>;
      for (const row of rows ? [rows].flat() : []) {
        const profile = NAME[row.Name];
        if (profile) values[profile] = { state: /^(True|1)$/i.test(row.On) ? 'on' : 'off', outbound: /^Block/i.test(row.Out) ? 'block' : 'allow', inbound: /^Allow/i.test(row.In) ? 'allowinbound' : 'blockinbound' };
      }
      if (!values.domain || !values.private || !values.public) throw new Error('The firewall\'s profiles can\'t be read');
      this.profiles = { at: Date.now(), values };
    }
    return this.profiles.values[name];
  }

  async setState(name: FirewallProfile, state: 'on' | 'off'): Promise<void> {
    const profile = await this.profile(name);
    await this.set(name, 'state', state);
    profile.state = state;
  }

  /** Allow or block what no rule speaks of, going out. What comes in stays as it is. */
  async setOutbound(name: FirewallProfile, outbound: 'allow' | 'block'): Promise<void> {
    const profile = await this.profile(name);
    await this.set(name, 'firewallpolicy', `${profile.inbound},${outbound}outbound`);
    profile.outbound = outbound;
  }

  /** (What was read is kept up to date by hand: reading it again costs a second or more each time.) */
  private async set(name: FirewallProfile, what: string, value: string): Promise<void> {
    const done = await netsh('set', `${name}profile`, what, value);
    if (done.ok) return;
    this.profiles = undefined;
    throw new Error(`netsh set ${name}profile ${what} ${value}: ${done.out || done.err}`);
  }

  /** Is there a rule with this name? (netsh says so by its exit code, in any language.) */
  async hasRule(name: string): Promise<boolean> {
    return (await netsh('firewall', 'show', 'rule', `name=${name}`)).ok;
  }

  /** Makes an outbound allow rule, in the place of any rule that already has its name. */
  async addRule(rule: FirewallRule): Promise<void> {
    await this.deleteRule(rule.name);
    const args = [`name=${rule.name}`, 'dir=out', 'action=allow', `protocol=${rule.protocol}`];
    if (rule.program) args.push(`program=${expandEnv(rule.program)}`);
    if (rule.service) args.push(`service=${rule.service}`);
    if (rule.remoteAddress) args.push(`remoteip=${rule.remoteAddress}`);
    if (rule.remotePorts?.length) args.push(`remoteport=${rule.remotePorts.join(',')}`);
    if (rule.localPorts?.length) args.push(`localport=${rule.localPorts.join(',')}`);
    const added = await netsh('firewall', 'add', 'rule', ...args);
    if (!added.ok) throw new Error(`netsh add rule ${rule.name}: ${added.out || added.err}`);
  }

  async deleteRule(name: string): Promise<void> {
    if (await this.hasRule(name)) await netsh('firewall', 'delete', 'rule', `name=${name}`);
  }
}
