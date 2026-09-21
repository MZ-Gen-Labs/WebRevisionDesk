import test from "node:test";
import assert from "node:assert/strict";
import { findNextTextMatch, findTextMatches, normalizeSearchReplaceRule, replacementPreview } from "../../src/search-replace.js";

test("a forbidden prefix excludes already-renamed terms", () => {
  const rule = {
    search: "旧名称",
    replacement: "新名称",
    forbiddenBefore: "新名称",
    forbiddenBeforeDistance: 1,
  };
  const text = "旧名称 と 新名称 旧名称";
  const first = findNextTextMatch(text, rule);
  assert.equal(first.index, 0);
  assert.equal(replacementPreview(text, first), "新名称 と 新名称 旧名称");
  assert.equal(findNextTextMatch(text, rule, first.index + first.length), null);
});

test("prefix conditions support OR and AND modes", () => {
  const text = "分類A 分類B 対象語";
  assert.ok(findNextTextMatch(text, {
    search: "対象語", replacement: "変更語", requiredBefore: "分類A\n分類C", requiredMode: "or", requiredBeforeDistance: 8,
  }));
  assert.ok(findNextTextMatch(text, {
    search: "対象語", replacement: "変更語", requiredBefore: "分類A\n分類B", requiredMode: "and", requiredBeforeDistance: 8,
  }));
  assert.equal(findNextTextMatch(text, {
    search: "対象語", replacement: "変更語", requiredBefore: "分類A\n分類C", requiredMode: "and", requiredBeforeDistance: 8,
  }), null);
});

test("regular expressions and capture references can build replacements", () => {
  const text = "項目: CODE-2026";
  const match = findNextTextMatch(text, {
    search: "CODE-(\\d{4})",
    replacement: "NEW-$1",
    useRegex: true,
  });
  assert.equal(match.replacement, "NEW-2026");
  assert.equal(replacementPreview(text, match), "項目: NEW-2026");
});

test("all matches retain condition exclusions for review highlighting", () => {
  const matches = findTextMatches("旧名称 / 新名称 旧名称 / 旧名称 2025", {
    search: "旧名称",
    replacement: "新名称",
    forbiddenBefore: "新名称",
    forbiddenAfter: "2025\n除外語",
    forbiddenBeforeDistance: 1,
    forbiddenAfterDistance: 1,
  });
  assert.deepEqual(matches.map((match) => ({ excluded: match.excluded, reasons: match.excludedReasons })), [
    { excluded: false, reasons: [] },
    { excluded: true, reasons: ["forbidden-before"] },
    { excluded: true, reasons: ["forbidden-after"] },
  ]);
});

test("condition distances count only the gap between the condition and search strings", () => {
  const beforeRule = {
    search: "対象語",
    replacement: "変更語",
    forbiddenBefore: "前置語",
    forbiddenBeforeDistance: 1,
  };
  assert.equal(findNextTextMatch("前置語 対象語", beforeRule), null);
  assert.ok(findNextTextMatch("前置語  対象語", beforeRule));

  const afterRule = {
    search: "対象",
    replacement: "変更",
    forbiddenAfter: "除外語",
    forbiddenAfterDistance: 4,
  };
  assert.equal(findNextTextMatch("対象の除外語", afterRule), null);
  assert.equal(findNextTextMatch("対象の高度な除外語", afterRule), null);
  assert.ok(findNextTextMatch("対象の高度な制御が可能な除外語", afterRule));
});

test("legacy lookaround ranges migrate to condition-specific maximum distances", () => {
  const migrated = normalizeSearchReplaceRule({
    search: "対象語",
    forbiddenBefore: "prefix-value",
    forbiddenAfter: "2025\nabc",
    lookbehindLength: 30,
    lookaheadLength: 8,
  });
  assert.equal(migrated.forbiddenBeforeDistance, 18);
  assert.equal(migrated.forbiddenAfterDistance, 5);
  assert.equal("lookbehindLength" in migrated, false);
  assert.equal("lookaheadLength" in migrated, false);
});
