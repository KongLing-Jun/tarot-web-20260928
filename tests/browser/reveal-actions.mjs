import assert from 'node:assert/strict';
export async function revealAction(page, name) {
  const trigger = page.getByRole('button', { name: '揭牌更多操作', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return page.getByRole('menuitem', { name, exact: true });
}

export async function revealNext(page, touch = false) {
  const progress = page
    .getByRole('region', { name: '揭牌', exact: true })
    .getByRole('status')
    .first();
  const before = await progress.textContent();
  const card = page.getByRole('button', { name: /，点击揭牌$/ });
  if (touch) await card.tap();
  else await card.click();
  assert.notEqual(await progress.textContent(), before, '一次轻点即揭牌');
}
