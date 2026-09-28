// Open the secondary drawing actions through the same menu used by the user.
export async function drawAction(page, name) {
  const trigger = page.getByRole('button', { name: '抽牌更多操作', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return page.getByRole('menuitem', { name, exact: true });
}
