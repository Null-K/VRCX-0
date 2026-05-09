# VRCX-0

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja-JP.md)

VRCX-0 is a fork of VRCX that replaces the previous CEF-based architecture with **Tauri + React**.
Development is led by one of VRCX's former core developers.

VRCX-0 is designed around players' everyday use: lower resource usage, a smaller app, and continued feature development and support.

The current VRCX project is largely stable, and future upstream changes are expected to focus mainly on maintenance and fixes. VRCX-0 will continue to receive new features, support, and roadmap updates.

## Highlights

- About 50%–70% lower memory usage compared to VRCX
- Windows and macOS installers are in the 20 MB range
- Much smaller application size
- New UI and interaction model
- Full keyboard navigation
- Continued feature development and support

## Data Migration

On first run, VRCX-0 can automatically migrate your existing VRCX database and settings.

Your original VRCX data is not modified.
Existing users can start using VRCX-0 with their current data without any manual setup.

## VROverlay

VROverlay support is planned.

It will be redesigned around practical use cases instead of directly reusing the old implementation.

## License

The initial commit of this repository corresponds to the upstream VRCX snapshot at the time of the fork and is licensed under the MIT License.

All modifications, additions, rewrites, and new code introduced after the fork are licensed under the GNU General Public License v3.0 (GPLv3).

## Development

Requirements:

- Node.js LTS
- Latest stable Rust toolchain via rustup

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
npm run tauri:dev
