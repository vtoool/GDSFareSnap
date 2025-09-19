# Kayak ➜ *I Chrome extension

This repository contains an unpacked Chromium extension that adds a “*I” copy pill to expanded Kayak itineraries and a popup to configure booking class and segment status defaults.

## Installation

1. Download the repository as a ZIP file or clone it locally.
2. If you downloaded the ZIP on Windows, right-click the file, choose **Properties** and click **Unblock** before extracting. This prevents Windows from marking the files as untrusted, which can stop Chromium-based browsers from reading the manifest.
3. Extract the archive so that `manifest.json` and the rest of the source files sit directly inside the folder you load.
4. Open `chrome://extensions` (or the equivalent in Edge), enable **Developer mode**, and choose **Load unpacked**.
5. Select the folder that contains `manifest.json`.

Once loaded, open the popup to adjust booking class or segment status defaults.

## Development

The project is a plain JavaScript extension. There is no build step. Run `npx web-ext lint` to perform add-on validation.
