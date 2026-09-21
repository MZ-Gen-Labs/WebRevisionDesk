export const MAX_SEARCH_REPLACE_RULES = 10;

export const DEFAULT_SEARCH_REPLACE_RULE = Object.freeze({
  id: "",
  name: "",
  enabled: true,
  search: "",
  replacement: "",
  useRegex: false,
  caseSensitive: true,
  excludeLinkedText: false,
  excludeBreadcrumbText: false,
  searchScope: "page",
  searchSelector: "",
  requiredBefore: "",
  requiredMode: "or",
  requiredBeforeDistance: 2,
  forbiddenBefore: "",
  forbiddenMode: "or",
  forbiddenBeforeDistance: 2,
  forbiddenAfter: "",
  forbiddenAfterMode: "or",
  forbiddenAfterDistance: 2,
  prefixUsesRegex: false,
});

function terms(value) {
  return String(value || "").split(/\r?\n/).map((term) => term.trim()).filter(Boolean);
}

function clampDistance(value, fallback = 2) {
  const number = Number(value);
  return Math.min(500, Math.max(0, Number.isFinite(number) ? number : fallback));
}

function migratedDistance(rule, field, legacyField, conditionValue, fallback) {
  if (Object.hasOwn(rule, field)) return clampDistance(rule[field], fallback);
  if (!Object.hasOwn(rule, legacyField)) return fallback;
  const legacyRange = clampDistance(rule[legacyField], fallback);
  if (rule.prefixUsesRegex) return legacyRange;
  const lengths = terms(conditionValue).map((term) => [...term].length).filter(Boolean);
  return lengths.length ? Math.max(0, legacyRange - Math.min(...lengths)) : fallback;
}

function conditionIsNear(pattern, text, boundary, direction, maxDistance, useRegex, caseSensitive) {
  const segment = direction === "before" ? text.slice(0, boundary) : text.slice(boundary);
  if (useRegex) {
    const expression = new RegExp(pattern, `${caseSensitive ? "" : "i"}gu`);
    for (let match = expression.exec(segment); match; match = expression.exec(segment)) {
      const distance = direction === "before"
        ? [...segment.slice(match.index + match[0].length)].length
        : [...segment.slice(0, match.index)].length;
      if (distance >= 0 && distance <= maxDistance) return true;
      if (match[0].length === 0) expression.lastIndex += 1;
    }
    return false;
  }
  const haystack = caseSensitive ? segment : segment.toLocaleLowerCase();
  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase();
  if (direction === "before") {
    const index = haystack.lastIndexOf(needle);
    return index >= 0 && [...segment.slice(index + needle.length)].length <= maxDistance;
  }
  const index = haystack.indexOf(needle);
  return index >= 0 && [...segment.slice(0, index)].length <= maxDistance;
}

function testConditions(patterns, mode, text, boundary, direction, maxDistance, useRegex, caseSensitive) {
  if (!patterns.length) return false;
  const results = patterns.map((pattern) => conditionIsNear(
    pattern, text, boundary, direction, maxDistance, useRegex, caseSensitive,
  ));
  return mode === "and" ? results.every(Boolean) : results.some(Boolean);
}

export function normalizeSearchReplaceRule(rule = {}, index = 0) {
  const normalized = {
    ...DEFAULT_SEARCH_REPLACE_RULE,
    ...rule,
    id: String(rule.id || `rule-${Date.now()}-${index}`),
    name: String(rule.name || `ルール ${index + 1}`),
    enabled: rule.enabled !== false,
    excludeLinkedText: rule.excludeLinkedText === true,
    excludeBreadcrumbText: rule.excludeBreadcrumbText === true,
    searchScope: ["page", "article", "selector"].includes(rule.searchScope) ? rule.searchScope : "page",
    searchSelector: String(rule.searchSelector || ""),
    requiredMode: rule.requiredMode === "and" ? "and" : "or",
    requiredBeforeDistance: migratedDistance(rule, "requiredBeforeDistance", "lookbehindLength", rule.requiredBefore, 2),
    forbiddenMode: rule.forbiddenMode === "and" ? "and" : "or",
    forbiddenBeforeDistance: migratedDistance(rule, "forbiddenBeforeDistance", "lookbehindLength", rule.forbiddenBefore, 2),
    forbiddenAfterMode: rule.forbiddenAfterMode === "and" ? "and" : "or",
    forbiddenAfterDistance: migratedDistance(rule, "forbiddenAfterDistance", "lookaheadLength", rule.forbiddenAfter, 2),
  };
  delete normalized.lookbehindLength;
  delete normalized.lookaheadLength;
  return normalized;
}

export function validateSearchReplaceRule(rule) {
  if (!String(rule.search || "")) throw new Error("検索文字列を入力してください。");
  const flags = `${rule.caseSensitive ? "" : "i"}gu`;
  if (rule.useRegex) new RegExp(rule.search, flags);
  if (rule.prefixUsesRegex) {
    [...terms(rule.requiredBefore), ...terms(rule.forbiddenBefore), ...terms(rule.forbiddenAfter)]
      .forEach((pattern) => new RegExp(pattern, rule.caseSensitive ? "u" : "iu"));
  }
  return true;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandReplacement(match, replacement, input) {
  return String(replacement).replace(/\$(\$|&|`|'|\d{1,2})/g, (token, key) => {
    if (key === "$") return "$";
    if (key === "&") return match[0];
    if (key === "`") return input.slice(0, match.index);
    if (key === "'") return input.slice(match.index + match[0].length);
    const index = Number(key);
    return Number.isInteger(index) && index > 0 && index < match.length ? match[index] ?? "" : token;
  });
}

export function findTextMatches(text, inputRule, startIndex = 0) {
  const rule = normalizeSearchReplaceRule(inputRule);
  validateSearchReplaceRule(rule);
  const flags = `${rule.caseSensitive ? "" : "i"}gu`;
  const expression = new RegExp(rule.useRegex ? rule.search : escapeRegex(rule.search), flags);
  expression.lastIndex = Math.max(0, startIndex);
  const matches = [];
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    const searchStart = match.index;
    const searchEnd = match.index + match[0].length;
    const prefix = text.slice(Math.max(0, searchStart - 80), searchStart);
    const suffix = text.slice(searchEnd, searchEnd + 80);
    const required = terms(rule.requiredBefore);
    const forbidden = terms(rule.forbiddenBefore);
    const forbiddenAfter = terms(rule.forbiddenAfter);
    const requiredMatches = !required.length || testConditions(
      required, rule.requiredMode, text, searchStart, "before", rule.requiredBeforeDistance,
      rule.prefixUsesRegex, rule.caseSensitive,
    );
    const forbiddenMatches = forbidden.length && testConditions(
      forbidden, rule.forbiddenMode, text, searchStart, "before", rule.forbiddenBeforeDistance,
      rule.prefixUsesRegex, rule.caseSensitive,
    );
    const forbiddenAfterMatches = forbiddenAfter.length
      && testConditions(
        forbiddenAfter, rule.forbiddenAfterMode, text, searchEnd, "after", rule.forbiddenAfterDistance,
        rule.prefixUsesRegex, rule.caseSensitive,
      );
    const excludedReasons = [];
    if (!requiredMatches) excludedReasons.push("required-before");
    if (forbiddenMatches) excludedReasons.push("forbidden-before");
    if (forbiddenAfterMatches) excludedReasons.push("forbidden-after");
    matches.push({
      index: match.index,
      length: match[0].length,
      matched: match[0],
      replacement: expandReplacement(match, rule.replacement, text),
      prefix,
      suffix,
      excluded: excludedReasons.length > 0,
      excludedReasons,
    });
    if (match[0].length === 0) expression.lastIndex += 1;
  }
  return matches;
}

export function findNextTextMatch(text, inputRule, startIndex = 0) {
  return findTextMatches(text, inputRule, startIndex).find((match) => !match.excluded) || null;
}

export function replacementPreview(text, match) {
  return `${text.slice(0, match.index)}${match.replacement}${text.slice(match.index + match.length)}`;
}
