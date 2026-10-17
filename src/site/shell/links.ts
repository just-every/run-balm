// Where the run site's links go. The run site never links an instance-only route (/signin, /setup, /app).
// "Try the demo" opens the hosted demo: a visitor's own throwaway clinic, signed in.
import run from '../run.json'

export const links = { home: '/', run: '/run', docs: '/docs', contract: '/contract', source: run.repository, demo: 'https://demo.run-balm.com/', licence: `${run.repository}/blob/main/LICENSE` }
export const docsPath = (slug: string) => `/docs/${slug}`
