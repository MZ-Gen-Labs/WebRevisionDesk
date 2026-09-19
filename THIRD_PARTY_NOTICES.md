# Third-party software notices

## Electron

- Project: Electron
- Website: https://www.electronjs.org/
- Source: https://github.com/electron/electron
- License: MIT
- Use in this project: Feasibility testing for a self-contained desktop shell, page rendering, Chromium networking, and page capture without Playwright at runtime.

Electron distributions include Chromium, Node.js, and other third-party components. Distributed Electron builds must retain the license files included in the official Electron distribution.

## Playwright

- Project: Microsoft Playwright
- Website: https://playwright.dev/
- Source: https://github.com/microsoft/playwright
- License: Apache License 2.0
- Use in this project: Launching a local Chromium browser and reading a user-selected rendered page for HTML capture.

Playwright is used without incorporating SingleFile source code. Keep Playwright's license and notices with distributed builds.

## Vite

- Project: Vite
- Website: https://vite.dev/
- Source: https://github.com/vitejs/vite
- License: MIT
- Use in this project: Local development server and frontend build.

## fflate

- Project: fflate
- Source: https://github.com/101arrowz/fflate
- License: MIT
- Use in this project: Creating the downloadable project ZIP archive in the browser.

This file is an engineering inventory, not legal advice. Confirm the exact dependency versions and their bundled notices before commercial distribution.
