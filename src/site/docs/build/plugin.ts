import type { Plugin } from 'vite'
import { buildDocs } from './site.ts'

// The docs, rendered from docs/site.json and docs/*.md when Vite loads them, so no page parses Markdown at run time.
// `virtual:balm-docs` exports the sections (with each page's title and summary) and every page's body HTML and
// contents list. A broken link, a missing file or a level-1 heading fails the build.

export const docsModuleId = 'virtual:balm-docs'
const resolvedId = `\0${docsModuleId}`

export function docsSite(): Plugin {
  let root = process.cwd()
  return {
    name: 'balm:docs',
    configResolved(config) { root = config.root },
    resolveId(id) { if (id === docsModuleId) return resolvedId },
    load(id) {
      if (id !== resolvedId) return
      const site = buildDocs(root)
      for (const file of site.files) this.addWatchFile(file)
      this.addWatchFile(`${root}/src/site/run.json`)
      this.addWatchFile(`${root}/src/base/run-pricing.ts`)
      return `export const sections = ${JSON.stringify(site.sections)};\nexport const bodies = ${JSON.stringify(site.bodies)};\n`
    },
  }
}
