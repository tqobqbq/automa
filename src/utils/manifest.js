export function getExtensionManifest() {
  const chromeRuntime = typeof chrome !== 'undefined' ? chrome.runtime : null;
  const browserRuntime =
    typeof browser !== 'undefined' ? browser.runtime : null;
  const runtime = chromeRuntime || browserRuntime;

  if (typeof runtime?.getManifest === 'function') {
    return runtime.getManifest();
  }

  return {};
}

export function getExtensionVersion() {
  return getExtensionManifest().version || '';
}

export function isManifestV2() {
  return getExtensionManifest().manifest_version === 2;
}
