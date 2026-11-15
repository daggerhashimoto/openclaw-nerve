/** Words and numbers for the usage panel, kept out of the component file so fast refresh stays whole. */

/** Provider ids as the gateway reports them, in the product's own words. */
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  'openai-codex': 'OpenAI Codex',
  openai: 'OpenAI',
  google: 'Google',
  gemini: 'Gemini',
};

export function providerName(source: string): string {
  return PROVIDER_NAMES[source] ?? source.charAt(0).toUpperCase() + source.slice(1).replace(/-/g, ' ');
}

/** Dollars with thousands separators and two decimals, the same shape the top bar prints. */
export function fmtDollars(n: number, digits = 2): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A rate limit the operator should start watching, and one that is about to bite. */
export const LIMIT_WARNING_PERCENT = 80;
export const LIMIT_CRITICAL_PERCENT = 95;
