import {
  defaultDomainRuleForLens,
  domainAllowedByRule,
  domainFromUrl,
  effectiveDomainRuleForLens,
  parseLensDomainRules,
  setDomainAllowedForRule,
  type LensConfig,
  type LensDomainRule,
  type LensDomainRules,
} from "@lenses/shared";

export const LENS_DOMAIN_RULES_KEY = "lensDomainRules";

type DomainLensConfig = Pick<
  LensConfig,
  "allowedDomains" | "focus" | "id" | "name" | "visible"
>;

export interface DomainLensOption {
  lensId: string;
  name: string;
  checked: boolean;
  scopeLabel: string;
}

export function readLensDomainRules(value: unknown): LensDomainRules {
  return parseLensDomainRules(value);
}

export function domainLensOptions(
  lenses: readonly DomainLensConfig[],
  sourceUrl: string,
  rules: LensDomainRules
): DomainLensOption[] {
  const domain = domainFromUrl(sourceUrl);
  if (!domain) return [];

  return lenses
    .filter((lens) => lens.visible !== false && lens.focus === "source")
    .map((lens) => {
      const rule = effectiveDomainRuleForLens(lens, rules);
      const checked = domainAllowedByRule(rule, domain);
      return {
        lensId: lens.id,
        name: lens.name,
        checked,
        scopeLabel: describeDomainRule(rule, checked),
      };
    });
}

export function updateDomainRuleForLens(
  lens: Pick<LensConfig, "id" | "allowedDomains">,
  sourceUrl: string,
  checked: boolean,
  rules: LensDomainRules
): LensDomainRules {
  const domain = domainFromUrl(sourceUrl);
  if (!domain) return rules;

  const currentRule = rules[lens.id] ?? defaultDomainRuleForLens(lens);
  return {
    ...rules,
    [lens.id]: setDomainAllowedForRule(currentRule, domain, checked),
  };
}

function describeDomainRule(rule: LensDomainRule, checked: boolean): string {
  if (rule.mode === "all") {
    const blockedCount = rule.blockedDomains?.length ?? 0;
    if (!checked) return "Hidden here";
    if (blockedCount > 0) return `${blockedCount} hidden`;
    return "All domains";
  }
  if (checked) return "This domain";
  if (rule.allowedDomains.length === 0) return "No domains";
  return `${rule.allowedDomains.length} domain${rule.allowedDomains.length === 1 ? "" : "s"}`;
}
