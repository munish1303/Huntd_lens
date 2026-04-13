document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const backendUrlInput = document.getElementById('backendUrl');
  const enabledInput = document.getElementById('enabled');
  const saveButton = document.getElementById('saveButton');
  const statusText = document.getElementById('statusText');

  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  apiKeyInput.value = settings.apiKey || '';
  backendUrlInput.value = settings.backendUrl || 'http://localhost:3001';
  enabledInput.checked = settings.enabled !== false;

  saveButton.addEventListener('click', async () => {
    const backendUrl = backendUrlInput.value.trim();
    if (!/^https?:\/\//i.test(backendUrl)) {
      statusText.textContent = 'Backend URL must start with http or https.';
      return;
    }

    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: {
        apiKey: apiKeyInput.value.trim(),
        backendUrl,
        enabled: enabledInput.checked
      }
    });

    statusText.textContent = 'Settings saved!';
    setTimeout(() => {
      statusText.textContent = '';
    }, 2000);
  });
});
