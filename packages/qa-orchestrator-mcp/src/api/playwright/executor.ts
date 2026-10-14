import { join } from 'path';
import { ProjectConfig, inProject } from '../../core/config';
import { flattenReport, runPlaywright, writeConfig } from '../../core/playwright';
import { ExecutionResult, FailedTest } from '../schemas/failure';

/** Run one generated API spec against the project's API and summarise the result. */
export function runTests(cfg: ProjectConfig, testFilePath: string): ExecutionResult {
  const out = inProject(cfg, cfg.outputDir, 'api');
  const configFile = writeConfig(join(out, 'playwright.api.config.cjs'), {
    testDir: inProject(cfg, cfg.api.testsDir),
    fullyParallel: false,
    retries: 1,
    reporter: [['list'], ['json', { outputFile: join(out, 'results.json') }], ['html', { outputFolder: join(out, 'playwright-report'), open: 'never' }]],
    outputDir: join(out, 'test-results'),
    use: { baseURL: cfg.api.baseUrl, extraHTTPHeaders: { Accept: 'application/json' }, trace: 'retain-on-failure' },
  });

  const run = runPlaywright({ root: cfg.root, files: [testFilePath], configFile, reportFile: join(out, 'results.json') });
  if (!run.report) {
    // Playwright never got as far as running tests (bad config, missing browser, syntax error…).
    return { total: 1, passed: 0, failed: 1, duration: 0, failures: [{ title: '(run)', error: run.output.slice(0, 4000) }], rawOutput: run.output };
  }

  const tests = flattenReport(run.report);
  const failures: FailedTest[] = tests
    .filter(t => t.status === 'failed' || t.status === 'timedOut')
    .map(t => {
      const msg = t.error ?? t.status;
      return {
        title: t.title,
        error: msg,
        expected: msg.match(/Expected(?:\s+value)?:\s*(\S+)/)?.[1],
        actual: msg.match(/Received(?:\s+value)?:\s*(\S+)/)?.[1],
      };
    });
  const stats = run.report.stats ?? {};
  return {
    total: tests.length,
    passed: stats.expected ?? tests.filter(t => t.status === 'passed').length,
    failed: failures.length,
    duration: stats.duration ?? 0,
    failures,
    rawOutput: run.output,
  };
}

/** Generated test titles are "<id>: <name>"; match a result back to its test case. */
export function titleMatches(title: string, tc: { id: string; name: string }): boolean {
  return title === tc.name || title === `${tc.id}: ${tc.name}` || title.startsWith(`${tc.id}:`);
}
