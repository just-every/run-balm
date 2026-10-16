// Where the run site's links go. The run site never links an instance-only route (/signin, /setup, /app).
// Balm has no hosted demo yet, so "Try the demo" opens /run, where it starts on your own computer.
import run from '../run.json'

export const links = { home: '/', run: '/run', docs: '/docs', source: run.repository, demo: '/run', licence: `${run.repository}/blob/main/LICENSE` }
export const docsPath = (slug: string) => `/docs/${slug}`
