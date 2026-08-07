import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const log = [];

  // Collect console errors (skip antd deprecation warnings)
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

  // ──────────────────────────────────────────
  // 1. Navigate to /tasks
  // ──────────────────────────────────────────
  await step('Navigate to /tasks', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
  });

  // ──────────────────────────────────────────
  // 2. Click "新建" button to create a task
  // ──────────────────────────────────────────
  await step('Click "新建" button', async () => {
    const btn = page.locator('button').filter({ hasText: '新建' });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(600);
  });

  // ──────────────────────────────────────────
  // 3. Inspect and fill the creation form
  // ──────────────────────────────────────────
  await step('Fill task creation form', async () => {
    // Check if a modal/drawer appeared
    await page.waitForTimeout(500);

    // Log what's visible
    const bodyText = await page.locator('body').innerText();
    const modalVisible = bodyText.includes('新建') || bodyText.includes('创建');
    log.push('  modal/dialog visible: ' + modalVisible);

    // Try to fill textarea
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('写一篇关于高血压的用药教育文章');
      log.push('  filled textarea');
    }

    // Try to fill input
    const input = page.locator('input').first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill('写一篇关于高血压的用药教育文章');
      log.push('  filled input');
    }

    await page.waitForTimeout(200);

    // Check for select dropdowns
    const selects = page.locator('.ant-select-selector');
    const selectCount = await selects.count();
    log.push('  ant-select count: ' + selectCount);
  });

  // ──────────────────────────────────────────
  // 4. Submit the form
  // ──────────────────────────────────────────
  await step('Submit task creation form', async () => {
    // Try several possible submit buttons
    const submitBtn = page.locator('.ant-modal-footer button.ant-btn-primary, .ant-modal .ant-btn-primary, button').filter({ hasText: /确[认定]|提交|创建|确定|OK/ }).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1500);
      log.push('  submitted form');
    } else {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      log.push('  pressed Enter');
    }
  });

  // ──────────────────────────────────────────
  // 5. Check if navigated to task detail page
  // ──────────────────────────────────────────
  await step('Check task detail page', async () => {
    const currentUrl = page.url();
    log.push('  current URL: ' + currentUrl);
    if (currentUrl.includes('/tasks/')) {
      log.push('  navigated to task detail page');
    }

    // Take screenshot
    await page.screenshot({ path: '/tmp/pw-smoke/01-task-detail.png', fullPage: true });
    log.push('  screenshot saved');
  });

  // ──────────────────────────────────────────
  // 6. Try to interact with task input area
  // ──────────────────────────────────────────
  await step('Interact with task (send clarification)', async () => {
    // If there's a textarea, send a response
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      // Check if there's a "发送" or submit button nearby
      await textarea.fill('确认无误，请继续');
      await page.waitForTimeout(200);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent user input to task via button');
        await page.waitForTimeout(1500);
      } else {
        await page.keyboard.press('Enter');
        log.push('  pressed Enter to send');
        await page.waitForTimeout(1500);
      }
    } else {
      log.push('  no textarea found on task detail page');
    }
  });

  // ──────────────────────────────────────────
  // 7. Navigate to /chat
  // ──────────────────────────────────────────
  await step('Navigate to /chat', async () => {
    await page.goto(BASE + '/chat', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/pw-smoke/02-chat.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 8. Select a chat session
  // ──────────────────────────────────────────
  await step('Select a chat session', async () => {
    // Click on the first session item in the sidebar
    const session = page.locator('.ant-list-item, [class*="session"], [class*="chat-item"], .ant-menu-item').first();
    if (await session.isVisible().catch(() => false)) {
      await session.click();
      await page.waitForTimeout(1000);
      log.push('  selected first chat session');
    } else {
      log.push('  no session list items found');
    }
  });

  // ──────────────────────────────────────────
  // 9. Send a chat message
  // ──────────────────────────────────────────
  await step('Send a chat message', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('你好，请介绍一下你自己');
      await page.waitForTimeout(200);
      const sendBtn = page.locator('button').filter({ hasText: /发送|Send|➤/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent chat message');
        await page.waitForTimeout(2000);
      } else {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
      }
    } else {
      log.push('  no chat textarea found');
    }
  });

  // ──────────────────────────────────────────
  // 10. Navigate to /agents
  // ──────────────────────────────────────────
  await step('Navigate to /agents', async () => {
    await page.goto(BASE + '/agents', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/pw-smoke/03-agents.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 11. Click "编辑" on first agent
  // ──────────────────────────────────────────
  await step('Click "编辑" on first agent', async () => {
    const editBtn = page.locator('button, a, span').filter({ hasText: '编辑' }).first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(800);
      log.push('  clicked 编辑');
    } else {
      log.push('  no 编辑 button found');
    }
  });

  // ──────────────────────────────────────────
  // 12. Check agent edit modal
  // ──────────────────────────────────────────
  await step('Check agent edit modal', async () => {
    const modal = page.locator('.ant-modal').first();
    if (await modal.isVisible().catch(() => false)) {
      log.push('  agent edit modal visible');
      // Close the modal
      const closeBtn = page.locator('.ant-modal-close').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(300);
        log.push('  closed modal');
      }
    } else {
      log.push('  no modal appeared');
    }
  });

  // ──────────────────────────────────────────
  // 13. Navigate to /knowledge
  // ──────────────────────────────────────────
  await step('Navigate to /knowledge', async () => {
    await page.goto(BASE + '/knowledge', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/pw-smoke/04-knowledge.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 14. Click "新建" on knowledge page
  // ──────────────────────────────────────────
  await step('Click "新建" on knowledge page', async () => {
    const btn = page.locator('button').filter({ hasText: '新建' }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(500);
      log.push('  clicked 新建 on knowledge');
    } else {
      log.push('  no 新建 button found');
    }
  });

  // ──────────────────────────────────────────
  // 15. Navigate to /templates
  // ──────────────────────────────────────────
  await step('Navigate to /templates', async () => {
    await page.goto(BASE + '/templates', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/pw-smoke/05-templates.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 16. Click the first template card
  // ──────────────────────────────────────────
  await step('Click first template card', async () => {
    const card = page.locator('.ant-card, [class*="template-card"], .ant-list-item').first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);
      log.push('  clicked first template card');
      await page.screenshot({ path: '/tmp/pw-smoke/06-template-detail.png', fullPage: true });
    } else {
      log.push('  no template card found');
    }
  });

  // ──────────────────────────────────────────
  // 17. Navigate to /settings
  // ──────────────────────────────────────────
  await step('Navigate to /settings', async () => {
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/pw-smoke/07-settings.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 18. Click "添加模型配置" if available
  // ──────────────────────────────────────────
  await step('Check settings interactions', async () => {
    const addBtn = page.locator('button').filter({ hasText: /添加|新增/ }).first();
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);
      log.push('  clicked add model config');

      // Fill in fields
      const inputs = page.locator('input');
      const count = await inputs.count();
      log.push('  ' + count + ' input fields visible');
      if (count > 0) {
        await inputs.first().fill('test-key-12345');
        await page.waitForTimeout(200);
      }

      // Close modal
      const closeBtn = page.locator('.ant-modal-close').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(300);
        log.push('  closed modal');
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } else {
      log.push('  no add button found');
    }
  });

  // ──────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────
  log.push('\n\n=== TEST SUMMARY ===');
  log.push('Console errors: ' + (errors.length > 0 ? errors.join(' | ') : '0'));
  log.push('Page errors: ' + errors.length);

  console.log(log.join('\n'));
  await browser.close();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });