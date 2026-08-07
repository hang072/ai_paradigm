import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const ssPath = 'D:/DH/Project/paradigm_eino/e2e/screenshots/expert-team';
fs.mkdirSync(ssPath, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const log = [];
  let stepNum = 0;

  const errors = [];
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('deprecated') && !t.includes('Warning')) errors.push(t);
  });
  page.on('pageerror', e => errors.push('PAGE_ERROR: ' + e.message));

  async function step(label, fn) {
    stepNum++;
    log.push(`\n=== ${stepNum}. ${label} ===`);
    try {
      await fn();
      log.push(`  [PASS] ${label}`);
    } catch (e) {
      log.push(`  [FAIL] ${label}: ${e.message}`);
    }
  }

  // ──────────────────────────────────────────
  // 1. Navigate to Templates page
  // ──────────────────────────────────────────
  await step('Navigate to /templates', async () => {
    await page.goto(BASE + '/templates', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${ssPath}/01-templates-home.png`, fullPage: true });
    log.push('  templates page loaded');
  });

  // ──────────────────────────────────────────
  // 2. Find and click "完整流程" template
  // ──────────────────────────────────────────
  await step('Find "完整流程" template card', async () => {
    const templateCard = page.locator('.ant-card').filter({ hasText: '完整流程' }).first();
    if (await templateCard.isVisible().catch(() => false)) {
      await templateCard.click();
      await page.waitForTimeout(1000);
      log.push('  clicked "完整流程" template');
      await page.screenshot({ path: `${ssPath}/02-template-detail.png`, fullPage: true });
    } else {
      const listItem = page.locator('.ant-list-item').filter({ hasText: '完整流程' }).first();
      if (await listItem.isVisible().catch(() => false)) {
        await listItem.click();
        await page.waitForTimeout(1000);
        log.push('  clicked list item');
      } else {
        log.push('  template not found via card/list');
      }
    }
  });

  // ──────────────────────────────────────────
  // 3. Check flow canvas preview
  // ──────────────────────────────────────────
  await step('Check flow canvas rendering', async () => {
    const canvas = page.locator('.react-flow').first();
    if (await canvas.isVisible().catch(() => false)) {
      log.push('  flow canvas visible');
      const nodes = await canvas.locator('.react-flow__node').count();
      log.push(`  nodes count: ${nodes}`);
      const edges = await canvas.locator('.react-flow__edge').count();
      log.push(`  edges count: ${edges}`);
      await page.screenshot({ path: `${ssPath}/03-flow-canvas.png`, fullPage: true });
    } else {
      log.push('  no canvas visible on templates page');
    }
  });

  // ──────────────────────────────────────────
  // 4. Go to tasks page and create task
  // ──────────────────────────────────────────
  await step('Navigate to /tasks and click 新建', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    const newBtn = page.locator('button').filter({ hasText: '新建' }).first();
    await newBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${ssPath}/04-create-task-modal.png`, fullPage: false });
  });

  // ──────────────────────────────────────────
  // 5. Select workflow template
  // ──────────────────────────────────────────
  await step('Select "文章" type and "完整流程" template', async () => {
    const articleBtn = page.locator('.ant-radio-button-wrapper').nth(1);
    await articleBtn.click({ force: true });
    await page.waitForTimeout(300);

    const select = page.locator('.ant-select-selector').first();
    await select.click();
    await page.waitForTimeout(500);

    const option = page.locator('.ant-select-item-option').filter({ hasText: '完整流程' }).first();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
      log.push('  selected "完整流程" template');
    } else {
      const firstOpt = page.locator('.ant-select-item-option').first();
      if (await firstOpt.isVisible().catch(() => false)) {
        await firstOpt.click();
        log.push('  selected first available template');
      }
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${ssPath}/05-template-selected.png`, fullPage: false });
  });

  // ──────────────────────────────────────────
  // 6. Fill detailed brief content
  // ──────────────────────────────────────────
  await step('Fill detailed medical content brief', async () => {
    const textarea = page.locator('textarea').first();
    const brief = `主题: 2型糖尿病患者的胰岛素起始治疗策略
目标受众: 基层医院内分泌科医生
内容要求:
1. 详细描述胰岛素起始治疗的指征
2. 基础胰岛素与预混胰岛素的选择比较
3. 剂量计算方法与滴定方案
4. 常见不良反应及处理
5. 患者教育要点
输出格式: 结构化医学指南解读`;
    await textarea.fill(brief);
    await page.waitForTimeout(500);
    log.push('  filled detailed brief content');
  });

  // ──────────────────────────────────────────
  // 7. Start the task
  // ──────────────────────────────────────────
  await step('Start task (点击"启动")', async () => {
    const startBtn = page.locator('.ant-modal-footer button.ant-btn-primary').first();
    await startBtn.click({ force: true });
    log.push('  started task');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${ssPath}/06-task-started.png`, fullPage: true });
  });

  // ──────────────────────────────────────────
  // 8. Check task detail page
  // ──────────────────────────────────────────
  await step('Verify task detail page', async () => {
    const url = page.url();
    log.push('  current URL: ' + url);
    const pageText = await page.locator('body').innerText();

    if (pageText.includes('运行中') || pageText.includes('进行中')) {
      log.push('  STATUS: task is running');
    }
    if (pageText.includes('等待人工')) {
      log.push('  STATUS: waiting for human input');
    }
    if (pageText.includes('已完成')) {
      log.push('  STATUS: completed');
    }
    await page.screenshot({ path: `${ssPath}/07-task-status.png`, fullPage: true });
  });

  // ──────────────────────────────────────────
  // 9. Observe flow execution progression
  // ──────────────────────────────────────────
  await step('Observe flow execution (5 snapshots)', async () => {
    const canvas = page.locator('.react-flow').first();
    if (await canvas.isVisible().catch(() => false)) {
      log.push('  flow canvas is rendering');
      for (let i = 1; i <= 5; i++) {
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${ssPath}/08-flow-${i}.png`, fullPage: true });
        const totalNodes = await canvas.locator('.react-flow__node').count();
        const running = await canvas.locator('.react-flow__node').filter({ has: page.locator('[class*="running"]') }).count();
        const done = await canvas.locator('.react-flow__node').filter({ has: page.locator('[class*="done"], [class*="success"]') }).count();
        log.push(`  snapshot ${i}: total=${totalNodes}, running=${running}, done=${done}`);
      }
    } else {
      log.push('  NOTE: no flow canvas visible (TaskDetail null check issue known)');
    }
  });

  // ──────────────────────────────────────────
  // 10. Check for interrupt state
  // ──────────────────────────────────────────
  await step('Check for human interaction / interrupt', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      log.push('  INTERRUPT DETECTED: task is requesting human input');

      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('澄清')) log.push('  -> clarification request');
      if (bodyText.includes('策略') || bodyText.includes('确认')) log.push('  -> strategy confirmation stage');
      if (bodyText.includes('审核') || bodyText.includes('修订')) log.push('  -> review / revision stage');

      await page.screenshot({ path: `${ssPath}/09-interrupt.png`, fullPage: true });

      await textarea.fill('信息确认无误，请继续执行。确保胰岛素剂量计算部分准确详细，重点突出基层易用性。');
      await page.waitForTimeout(500);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent human response - resuming task');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${ssPath}/10-after-resume.png`, fullPage: true });
      }
    } else {
      log.push('  no interrupt detected - task still running');
    }
  });

  // ──────────────────────────────────────────
  // 11. Observe after resume
  // ──────────────────────────────────────────
  await step('Continue observing after resume (4 snapshots)', async () => {
    for (let i = 1; i <= 4; i++) {
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${ssPath}/11-resumed-${i}.png`, fullPage: true });
      log.push(`  resumed observation ${i}`);
    }
  });

  // ──────────────────────────────────────────
  // 12. Check second interrupt (strategy confirmation)
  // ──────────────────────────────────────────
  await step('Check for second interrupt / strategy confirmation', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      log.push('  SECOND INTERRUPT: strategy confirmation stage');
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('策略') || bodyText.includes('大纲')) {
        log.push('  -> strategy / outline confirmation detected');
      }
      await page.screenshot({ path: `${ssPath}/12-strategy-confirm.png`, fullPage: true });

      await textarea.fill('策略确认通过，大纲结构合理。请继续按照此框架生成完整内容。');
      await page.waitForTimeout(500);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  confirmed strategy - resuming content generation');
        await page.waitForTimeout(3000);
      }
    } else {
      log.push('  no second interrupt - proceeding to content generation');
    }
  });

  // ──────────────────────────────────────────
  // 13. Observe final stages
  // ──────────────────────────────────────────
  await step('Observe final content generation and review', async () => {
    for (let i = 1; i <= 5; i++) {
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${ssPath}/13-final-stage-${i}.png`, fullPage: true });
      log.push(`  final stage observation ${i}`);
    }
  });

  // ──────────────────────────────────────────
  // 14. Final state check
  // ──────────────────────────────────────────
  await step('Final state and output check', async () => {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${ssPath}/14-final-state.png`, fullPage: true });

    const pageText = await page.locator('body').innerText();
    if (pageText.includes('已完成') || pageText.includes('完成')) {
      log.push('  ✓ TASK COMPLETED');
    }
    if (pageText.includes('目录') || pageText.includes('大纲') || pageText.includes('章节')) {
      log.push('  ✓ CONTENT OUTPUT PRESENT');
    }
    if (pageText.includes('修订') || pageText.includes('审核')) {
      log.push('  REVIEW LOOP ACTIVE');
    }
  });

  // ──────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────
  log.push('\n\n═══════════════════════════════════════');
  log.push('        EXPERT TEAM TEST SUMMARY');
  log.push('═══════════════════════════════════════');
  log.push('Console errors: ' + (errors.length > 0 ? errors.join(' | ') : '0'));
  log.push('Page errors: ' + errors.length);
  log.push('Screenshots: ' + ssPath);
  log.push('Total steps: ' + stepNum);

  console.log(log.join('\n'));
  await browser.close();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });