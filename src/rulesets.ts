/** System-neutral ruleset metadata for Nexus Multiverse.
 * Campaigns always reference a versioned ruleset record in Supabase.
 * A game-specific UI adapter may supply presentation defaults, but must not
 * change inventory ownership, trading authorization or settlement rules.
 */
export type RulesetConfiguration = {
  attributes?: string[];
  slots?: string[];
  effects?: string[];
  currency?: { base?: string; denominations?: Record<string, number> };
  capacity_mode?: 'weight' | 'bulk' | 'optional' | string;
  [extension: string]: unknown;
};

export type RulesetRecord = {
  id: string;
  version_label: string;
  configuration?: RulesetConfiguration | null;
  game_systems?: { code?: string; name?: string } | null;
};

export type InventorySystemAdapter = {
  code: string;
  displayName: string;
  equipmentHeading: string;
  walletHeading: string;
  capacityLabel: string;
  primaryAttributeCodes: readonly string[];
};

/** These are presentation defaults, not the authoritative ruleset definition. */
const adapters: Record<string, InventorySystemAdapter> = {
  dnd5e: {
    code: 'dnd5e',
    displayName: 'Dungeons & Dragons 5e',
    equipmentHeading: 'Equipped Items',
    walletHeading: 'Currency',
    capacityLabel: 'Carrying Weight',
    primaryAttributeCodes: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
  },
};

export function adapterForRuleset(ruleset?: RulesetRecord | null): InventorySystemAdapter {
  const code = ruleset?.game_systems?.code ?? 'custom';
  if (adapters[code]) return adapters[code];
  return {
    code,
    displayName: ruleset?.game_systems?.name ?? 'Custom / Homebrew',
    equipmentHeading: 'Equipped Items',
    walletHeading: 'Currency',
    capacityLabel: 'Capacity',
    primaryAttributeCodes: ruleset?.configuration?.attributes ?? [],
  };
}

export function currencyDenominations(ruleset?: RulesetRecord | null): string[] {
  const denominations = ruleset?.configuration?.currency?.denominations;
  return denominations ? Object.keys(denominations).sort((a, b) => (denominations[b] ?? 0) - (denominations[a] ?? 0)) : [];
}

/** D&D is the first supported workflow; other published rulesets remain selectable. */
export function prioritizeStarterRulesets<T extends RulesetRecord>(rulesets: T[]): T[] {
  return [...rulesets].sort((a, b) => {
    const priority = (r: T) => r.game_systems?.code === 'dnd5e' ? 0 : 1;
    return priority(a) - priority(b) || (a.game_systems?.name ?? '').localeCompare(b.game_systems?.name ?? '') || b.version_label.localeCompare(a.version_label);
  });
}
