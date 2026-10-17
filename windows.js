// Opens a page in its own Chrome window without stealing focus, so each chat
// site stays the active (visible) tab of its window and nothing switches tabs.
export async function openInOwnWindow(context, url, { minimized = false } = {}) {
  const session = await context.browser().newBrowserCDPSession();
  const pageOpened = context.waitForEvent('page');
  const { targetId } = await session.send('Target.createTarget', { url, newWindow: true, background: true });
  // New windows inherit full screen, which on macOS is a separate Space where
  // the page counts as hidden — so always start from a normal window.
  const { windowId } = await session.send('Browser.getWindowForTarget', { targetId });
  await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
  if (minimized) {
    await new Promise((r) => setTimeout(r, 800)); // macOS animates leaving full screen
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }).catch(() => {});
  }
  await session.detach();
  const page = await pageOpened;
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}
