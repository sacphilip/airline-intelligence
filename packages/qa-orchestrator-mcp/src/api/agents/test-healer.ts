import { AnalysisResult, FailureAnalysis } from '../schemas/failure';

export function healTests(testSource: string, analysis: AnalysisResult): string {
  let healed = testSource;

  for (const failure of analysis.failures) {
    if (!failure.healable || !failure.proposedFix) continue;
    healed = applyHeal(healed, failure);
  }

  return healed;
}

function applyHeal(source: string, failure: FailureAnalysis): string {
  const fix = failure.proposedFix?.toLowerCase() ?? '';

  // Find the block for this test title by locating the first assertion after the title
  const titleEscaped = failure.testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (fix.includes('optional') || fix.includes('[200, 404]') || fix.includes('absent data')) {
    // Replace strict toBe(4xx) with a permissive < 500 check inside this test
    return source.replace(
      new RegExp(
        `(test\\([^,]+${titleEscaped}[^,]*,[\\s\\S]*?)(expect\\(res\\.status\\(\\)\\)\\.toBe\\(\\d+\\))`,
      ),
      '$1expect(res.status()).toBeLessThan(500)',
    );
  }

  if (fix.includes('fix the request params')) {
    // Cannot auto-fix without knowing the right params — leave unchanged
    return source;
  }

  if (fix.includes('optional chaining')) {
    return source.replace(
      /expect\(body\.(\w+)\)\.toBeDefined\(\)/g,
      'expect(body?.$1).toBeDefined()',
    );
  }

  return source;
}
