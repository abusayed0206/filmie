# Third-party notices

Filmie's own code is under the [MIT License](LICENSE). These components keep their own licenses.

## uBlock Origin Lite

The Windows installer bundles an unmodified copy of uBlock Origin Lite for ad blocking. It runs as a separate browser extension and isn't part of Filmie's MIT-licensed code.

- License: [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)
- Version: 2026.1026.1812, the Edge build
- Source: <https://github.com/uBlockOrigin/uBOL-home>
- Release used: <https://github.com/uBlockOrigin/uBOL-home/releases/tag/2026.1026.1812>

`scripts/fetch-ubol.ps1` downloads this version and checks its SHA-256 hash.

## Roboto

The app bundles the Latin subset of the Roboto variable font for its interface text.

- License: [SIL Open Font License 1.1](https://openfontlicense.org)
- Copyright 2011 The Roboto Project Authors
- Version: 5.3.0 of `@fontsource-variable/roboto`, file `ui/fonts/roboto-latin-wght-normal.woff2`
- Source: <https://github.com/googlefonts/roboto-classic>

## Bebas Neue

The website uses the Latin subset of Bebas Neue for its headings.

- License: [SIL Open Font License 1.1](https://openfontlicense.org)
- Copyright 2010 Dharma Type
- Version: 5.2.5 of `@fontsource/bebas-neue`, file `site/public/fonts/bebas-neue-latin-400-normal.woff2`
- Source: <https://github.com/dharmatype/Bebas-Neue>

## Rust crates

The app is built with [Tauri](https://tauri.app) and other open-source crates, listed in `src-tauri/Cargo.lock`. Each is distributed under the license stated by its publisher, in most cases MIT or Apache-2.0.

## Data and services

- Movie and TV data: [TMDB](https://www.themoviedb.org). Filmie uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.
- Watch tracking: [Trakt](https://trakt.tv). Filmie uses Trakt but is not endorsed or certified by Trakt.
