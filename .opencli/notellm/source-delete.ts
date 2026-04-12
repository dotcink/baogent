import { cli, Strategy } from '@jackwener/opencli/registry';

const DEFAULT_NOTEBOOK_URL = 'https://notebooklm.google.com/notebook/45c78782-31cd-44d2-897e-3b65f5a99060';

cli({
  site: 'notebooklm',
  name: 'source-delete',
  description: 'Delete a markdown source by title through NotebookLM UI automation.',
  domain: 'notebooklm.google.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'title', positional: true, type: 'string', required: true, help: 'Exact source title (use --partial to match substrings).' },
    { name: 'notebook', type: 'string', required: false, help: 'Notebook URL, defaults to the active notebook.' },
    { name: 'partial', type: 'boolean', default: false, help: 'Allow substring matches instead of exact equality.' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Locate the source without confirming Delete.' },
  ],
  columns: ['status', 'remaining'],
  func: async (page, kwargs) => {
    if (!page) throw new Error('Browser session is required. Use --browser to open NotebookLM.');

    const titleInput = String(kwargs.title || '').trim();
    if (!titleInput) throw new Error('Provide the markdown source title as the positional argument.');

    const notebookInput = String(kwargs.notebook || '').trim();
    const notebookUrl = notebookInput || DEFAULT_NOTEBOOK_URL;
    if (!notebookUrl) throw new Error('Notebook URL is required.');

    await page.goto(notebookUrl);
    await page.wait(5);

    const normalizedNeedle = titleInput.toLowerCase();
    const partialMatch = Boolean(kwargs.partial || kwargs['partial']);
    const dryRun = Boolean(kwargs['dry-run'] || kwargs.dry_run);

    const findResult = await page.evaluate(
      ({ needle, partialMatch }) => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const buttons = Array.from(document.querySelectorAll('button[id^="source-item-more-button"]'));
        const matches = [];

        for (const button of buttons) {
          const row = button.closest('[role="listitem"], .single-source-container') || button.parentElement;
          if (!row) continue;
          const titleNode = row.querySelector('[aria-label]');
          const rawTitle = titleNode?.getAttribute('aria-label') || row.textContent || '';
          const normalized = normalize(rawTitle);
          if (!normalized) continue;
          const lowered = normalized.toLowerCase();
          const match = partialMatch ? lowered.includes(needle) : lowered === needle;
          if (match) {
            matches.push({ button, row, title: normalized });
          }
        }

        if (matches.length !== 1) {
          return { ok: false, count: matches.length };
        }

        const target = matches[0];
        target.row.scrollIntoView({ block: 'center', inline: 'nearest' });
        ['mouseenter', 'mouseover', 'mousemove'].forEach((type) => {
          const event = new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
          target.row.dispatchEvent(event);
          target.button.dispatchEvent(event);
        });
        target.button.id = 'codex-target-more-button';
        target.row.setAttribute('data-codex-source-row', '1');
        return { ok: true, title: target.title };
      },
      { needle: normalizedNeedle, partialMatch }
    );

    if (!findResult.ok) {
      if (findResult.count === 0) {
        throw new Error(`Source not found: ${titleInput}`);
      }
      throw new Error(`Ambiguous matches for "${titleInput}" (${findResult.count} matches).`);
    }

    const highlightedTitle = findResult.title;
    const moreButton = await page.$('#codex-target-more-button');
    if (!moreButton) {
      throw new Error('Could not click the source More menu after locating the row.');
    }

    await moreButton.click();
    await page.wait(1);

    const removeClicked = await page.evaluate(() => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const menu = document.querySelector('[role="menu"]');
      const candidates = menu ? Array.from(menu.querySelectorAll('button')) : Array.from(document.querySelectorAll('button'));
      const target = candidates.find((btn) => normalize(btn.textContent || btn.innerText) === 'Remove source');
      if (!target) return false;
      target.click();
      return true;
    });

    if (!removeClicked) {
      throw new Error('The "Remove source" menu item did not appear.');
    }

    await page.wait(1);

    if (!dryRun) {
      const deleteClicked = await page.evaluate(() => {
        const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const dialog = document.querySelector('[role="dialog"]');
        const scope = dialog ? Array.from(dialog.querySelectorAll('button')) : Array.from(document.querySelectorAll('button'));
        const target = scope.find((btn) => normalize(btn.textContent || btn.innerText) === 'Delete');
        if (!target) return false;
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        target.click();
        return true;
      });
      if (!deleteClicked) {
        throw new Error('Could not confirm deletion: Delete button missing.');
      }
      await page.wait(4.5);
    } else {
      await page.wait(1);
    }

    const remaining = await page.evaluate(() => {
      const match = document.body.innerText.match(/\b(\d+) sources\b/);
      return match ? match[1] : 'unknown';
    });

    const status = dryRun ? `Dry run located "${highlightedTitle}"` : `Deleted "${highlightedTitle}"`;
    return [{ status, remaining }];
  },
});
