chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    apiKey: '',
    backendUrl: 'http://localhost:3001',
    enabled: true
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'FETCH_PROFILE_DATA') {
        const { apiKey, backendUrl } = await chrome.storage.local.get(['apiKey', 'backendUrl']);

        if (!apiKey) {
          sendResponse({ error: 'NO_API_KEY' });
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        try {
          const response = await fetch(`${backendUrl}/api/profile`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey
            },
            body: JSON.stringify({
              linkedinUrl: message.payload.linkedinUrl,
              profileData: message.payload.profileData
            }),
            signal: controller.signal
          });

          let responseJson = {};
          try {
            responseJson = await response.json();
          } catch (_error) {
            responseJson = {};
          }

          if (!response.ok) {
            sendResponse({
              error: 'API_ERROR',
              status: response.status,
              message: responseJson.error || 'Backend request failed'
            });
            return;
          }

          sendResponse({ success: true, data: responseJson });
        } catch (error) {
          sendResponse({
            error: 'NETWORK_ERROR',
            message: error.message
          });
        } finally {
          clearTimeout(timeoutId);
        }

        return;
      }

      if (message.type === 'GET_SETTINGS') {
        const settings = await chrome.storage.local.get(['apiKey', 'backendUrl', 'enabled']);
        sendResponse({
          apiKey: settings.apiKey || '',
          backendUrl: settings.backendUrl || 'http://localhost:3001',
          enabled: settings.enabled !== false
        });
        return;
      }

      if (message.type === 'SAVE_SETTINGS') {
        await chrome.storage.local.set({
          apiKey: message.payload.apiKey,
          backendUrl: message.payload.backendUrl,
          enabled: Boolean(message.payload.enabled)
        });
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'OPEN_POPUP') {
        if (chrome.action?.openPopup) {
          await chrome.action.openPopup();
          sendResponse({ success: true });
          return;
        }

        sendResponse({ success: false });
        return;
      }

      sendResponse({ success: false, error: 'UNKNOWN_MESSAGE' });
    } catch (error) {
      sendResponse({ success: false, error: 'UNEXPECTED_ERROR', message: error.message });
    }
  })();

  return true;
});
