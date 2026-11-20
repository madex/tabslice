# Third-Party Notices

TabSlice is licensed under the Mozilla Public License 2.0 (see [LICENSE](./LICENSE)).
This file lists the third-party components distributed with or fetched by the app.

## alphaTab

- Package: `@coderline/alphatab` (npm)
- Project: <https://github.com/Coderline/alphaTab> · <https://alphatab.net>
- License: Mozilla Public License 2.0 (MPL-2.0)
- License text: [licenses/alphaTab.txt](./licenses/alphaTab.txt)

Copyright © Daniel Kuschny and Contributors.

The alphaTab attribution (`♪ alphaTab.net`) in the rendered notation must remain
visible. Removing, hiding, covering or cropping it requires permission from the
alphaTab maintainers: <https://alphatab.net/docs/attribution>

alphaTab bundles the following libraries:

| Library | License | Copyright / Source |
| --- | --- | --- |
| TinySoundFont | MIT | © 2017–2018 Bernhard Schelling · <https://github.com/schellingb/TinySoundFont> |
| SFZero | MIT | © 2012 Steve Folta · <https://github.com/stevefolta/SFZero> |
| Bravura | SIL Open Font License 1.1 | © 2015 Steinberg Media Technologies GmbH · <https://github.com/steinbergmedia/bravura> |

## SoundFonts

The app can load the following SoundFonts. They are not part of the source code;
GeneralUser GS, FluidR3 and MuseScore General are downloaded on first use.

| SoundFont | License / Source |
| --- | --- |
| GeneralUser GS | Free to use and redistribute under its own license, see <https://www.schristiancollins.com/generaluser.php> |
| FluidR3 GM / FluidR3Mono | Distributed by the MuseScore project, see <https://github.com/musescore/MuseScore> |
| MuseScore General | Distributed by the MuseScore project, see <https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/> |
| Sonivox Kompakt | Apache License 2.0, see [`licenses/sonivox.txt`](./licenses/sonivox.txt) and [`licenses/Apache-2.0.txt`](./licenses/Apache-2.0.txt) |

## JavaScript dependencies

| Package | License |
| --- | --- |
| React / React DOM | MIT |
| Express | MIT |
| dotenv | BSD-2-Clause |
| lucide-react | ISC |
| motion | MIT |
| Vite | MIT |
| Tailwind CSS / `@tailwindcss/vite` | MIT |
| `@vitejs/plugin-react` | MIT |
| TypeScript | Apache-2.0 |
| tsx | MIT |
| autoprefixer | MIT |

The complete license texts of the installed packages are available in their
respective `node_modules/<package>/LICENSE*` files. The license texts relevant for
redistribution are bundled in [`licenses/`](./licenses):

- [`licenses/alphaTab.txt`](./licenses/alphaTab.txt) – alphaTab (MPL-2.0)
- [`licenses/sonivox.txt`](./licenses/sonivox.txt) – Sonivox notice
- [`licenses/Apache-2.0.txt`](./licenses/Apache-2.0.txt) – Apache License 2.0
