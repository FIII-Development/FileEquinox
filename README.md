# FileEquinox

FileEquinox is a small Electron-based file sharing app that hosts a local dashboard and serves a public download page over HTTP.

## Features

- Electron desktop app wrapper
- HTTP host dashboard for configuration and transfer monitoring
- Public file-sharing page for clients
- Simple local folder sharing workflow
- Public link

## Requirements

- Node.js 18+ or newer
- npm

## Install

```bash
npm install
```

## Run

```bash
npm start
```

## Build

```bash
npm run dist
```

## Format

```bash
npm run format
```

## Notes

- The default host dashboard is served on port `8443` and the public share interface uses port `80` unless changed from the dashboard.

## License

This project is licensed under the MIT. See [License.md](License.md) for details.

## Project History

FileEquinox started as a private, closed-source utility developed locally.
In July 2026, the codebase was audited, polished, and fully migrated to GitHub
as an open-source project to allow for community contributions and transparency.
