/* No scheduled jobs or persistent download queue. The manager tab owns the run. */
chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL('manager.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(tab => tab.url === url);
    if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId)
            await chrome.windows.update(existing.windowId, { focused: true });
    }
    else {
        await chrome.tabs.create({ url });
    }
});
