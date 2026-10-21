# Fonts

Every face here is self-hosted under the SIL Open Font License 1.1; each folder holds its licence. The Latin and
Latin Extended WOFF2 subsets come from Fontsource's variable distributions. No page makes a third-party font request.

| Face | Folder | Used for | Upstream |
| --- | --- | --- | --- |
| Newsreader (wght and opsz axes) | `newsreader/` | The Balm wordmark and every heading, on the run site and in the app | https://github.com/productiontype/Newsreader |
| Inter (wght axis) | `inter/` | Body text and the drawn cards on the run site | https://github.com/rsms/inter |
| JetBrains Mono (wght axis) | `jetbrains-mono/` | Commands and code on the run site | https://github.com/JetBrains/JetBrainsMono |
| Outfit (wght axis) | `outfit/` | The app's body text, until its design round | https://github.com/Outfitio/Outfit-Fonts |

`/rer-theme.css` declares all of them, so the installer serves them too, and the run site's own theme
(`/site/theme.css`) declares the three it uses. `fonts.css` sets the app's page font and carries Balm's own tokens and
Base's pages in its look, which the theme grammar keeps out of `/rer-theme.css`; every app document links it once,
before the theme. The app's root document links it outside the temporary dev SSR stylesheet and preloads only
Outfit's Latin file; the run site preloads Newsreader's and Inter's Latin files. Do not import these CSS files from a
component. Every body-font stack uses `--font-body`, including the local fallback faces before generic fallback fonts;
controls inherit it.

Each `… Fallback` face scales a local Arial or Georgia to the sampled advance widths (A-Z, a-z, 0-9) of its web face
at the weights it covers, with matching ascent and descent, which reduces layout movement while the web face loads.
Recalculate them when changing a face.
