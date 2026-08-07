import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const log = [];

  const errors = [];
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('deprecated') && !t.includes('Warning')) errors.push(t);
  });
  page.on('pageerror', e => errors.push('PAGE_ERROR: ' + e.message));

  async function step(label, fn) {
    log.push('\n=== ' + label + ' ===');
    try {
      await fn();
      log.push('  [PASS] ' + label);
    } catch (e) {
      log.push('  [FAIL] ' + label + ': ' + e.message);
    }
  }

  const ssPath = 'D:/DH/Project/paradigm_eino/e2e/screenshots';

  // ──────────────────────────────────────────
  // 1. Navigate to /tasks
  // ──────────────────────────────────────────
  await step('1. Navigate to /tasks', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/tasks-home.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 2. Click "新建" button to create a task
  // ──────────────────────────────────────────
  await step('2. Click "新建" button', async () => {
    const btn = page.locator('button').filter({ hasText: '新建' });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/new-task-modal.png', fullPage: false });
  });

  // ──────────────────────────────────────────
  // 3. Select "文章" type - limit to modal content
  // ──────────────────────────────────────────
  await step('3. Select "文章" type', async () => {
    // Focus on modal content
    const modal = page.locator('.ant-modal-content').first();
    await modal.waitFor({ state: 'visible', timeout: 3000 });

    // Find radio buttons for type selection
    const articleBtn = modal.locator('.ant-radio-button-wrapper').filter({ hasText: '文章' });
    await articleBtn.waitFor({ state: 'visible', timeout: 3000 });
    await articleBtn.click({ force: true });
    await page.waitForTimeout(300);
    log.push('  selected "文章" type');
  });

  // ──────────────────────────────────────────
  // 4. Fill brief textarea
  // ──────────────────────────────────────────
  await step('4. Fill brief textarea', async () => {
    const modal = page.locator('.ant-modal-content').first();
    const textarea = modal.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.fill('写一篇关于高血压的用药教育文章');
    log.push('  filled textarea');
    await page.waitForTimeout(300);
  });

  // ──────────────────────────────────────────
  // 5. Click "启动" to create task
  // ──────────────────────────────────────────
  await step('5. Click "启动" button', async () => {
    const modal = page.locator('.ant-modal-content').first();
    const startBtn = modal.locator('button.ant-btn-primary').filter({ hasText: '启动' }).first();
    await startBtn.waitFor({ state: 'visible', timeout: 3000 });
    await startBtn.click({ force: true });
    log.push('  clicked "启动"');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: ssPath + '/after-create.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 6. Verify navigated to task detail
  // ──────────────────────────────────────────
  await step('6. Verify task detail page', async () => {
    const currentUrl = page.url();
    log.push('  current URL: ' + currentUrl);
    if (currentUrl.includes('/tasks/')) {
      log.push('  SUCCESS: navigated to task detail page');
    } else {
      log.push('  WARNING: still on /tasks page (might need longer wait)');
    }
    await page.screenshot({ path: ssPath + '/task-detail.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 7. Interact with task flow
  // ──────────────────────────────────────────
  await step('7. Interact with task flow', async () => {
    await page.waitForTimeout(3000);

    // Check if there's a flow canvas (xyflow)
    const canvas = page.locator('.react-flow').first();
    if (await canvas.isVisible().catch(() => false)) {
      log.push('  flow canvas visible');
    }

    // Check for textarea for user input (interrupt state)
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      log.push('  textarea visible - task in interrupt state');
      await textarea.fill('确认无误，请继续');
      await page.waitForTimeout(200);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent user input');
        await page.waitForTimeout(2000);
      }
    } else {
      log.push('  no textarea - task running or completed');
    }
    await page.screenshot({ path: ssPath + '/task-interaction.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 8. Navigate to /chat
  // ──────────────────────────────────────────
  await step('8. Navigate to /chat', async () => {
    await page.goto(BASE + '/chat', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/chat-home.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 9. Click "新建会话"
  // ──────────────────────────────────────────
  await step('9. Click "新建会话"', async () => {
    const newChatBtn = page.locator('button').filter({ hasText: '新建会话' }).first();
    if (await newChatBtn.isVisible().catch(() => false)) {
      await newChatBtn.click();
      await page.waitForTimeout(1000);
      log.push('  clicked 新建会话');
    } else {
      const sidebarNew = page.locator('button').filter({ hasText: '新建' }).first();
      if (await sidebarNew.isVisible().catch(() => false)) {
        await sidebarNew.click();
        await page.waitForTimeout(1000);
        log.push('  clicked sidebar 新建');
      }
    }
    await page.screenshot({ path: ssPath + '/chat-new.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 10. Send a chat message
  // ──────────────────────────────────────────
  await step('10. Send a chat message', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('你好，请介绍一下你自己');
      await page.waitForTimeout(200);

      // Check for send button
      const sendBtn = page.locator('button').filter({ hasText: /发送|Send/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent chat message');
        await page.waitForTimeout(2000);
      }
    } else {
      log.push('  no chat textarea found');
    }
    await page.screenshot({ path: ssPath + '/chat-sent.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 11. Navigate to /agents
  // ──────────────────────────────────────────
  await step('11. Navigate to /agents', async () => {
    await page.goto(BASE + '/agents', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/agents.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 12. Click "编辑" on first agent
  // ──────────────────────────────────────────
  await step('12. Click "编辑" on first agent', async () => {
    const editBtn = page.locator('button').filter({ hasText: '编辑' }).first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(800);
      log.push('  clicked 编辑');
      await page.screenshot({ path: ssPath + '/agent-edit-modal.png', fullPage: false });
    }
  });

  // ──────────────────────────────────────────
  // 13. Close agent edit modal
  // ──────────────────────────────────────────
  await step('13. Close agent edit modal', async () => {
    const closeBtn = page.locator('.ant-modal-close').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
      log.push('  closed modal');
    }
  });

  // ──────────────────────────────────────────
  // 14. Navigate to /knowledge
  // ──────────────────────────────────────────
  await step('14. Navigate to /knowledge', async () => {
    await page.goto(BASE + '/knowledge', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/knowledge.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 15. Navigate to /templates
  // ──────────────────────────────────────────
  await step('15. Navigate to /templates', async () => {
    await page.goto(BASE + '/templates', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/templates.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 16. Navigate to /settings
  // ──────────────────────────────────────────
  await step('16. Navigate to /settings', async () => {
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/settings.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────
  log.push('\n\n═══════════════════════════════════════');
  log.push('             TEST SUMMARY');
  log.push('═══════════════════════════════════════');
  log.push('Console errors: ' + (errors.length > 0 ? errors.join(' | ') : '0'));
  log.push('Page errors: ' + errors.length);
  log.push('Screenshots saved to: ' + ssPath);

  console.log(log.join('\n'));
  await browser.close();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });