import { runPricing } from '../base/run-pricing'
import type { RunData } from '../base/run-site'
import data from './run.json'

// Seed facts and Base's one shared price source feed every run-site page.
export const run: RunData = { ...data, pricing: runPricing }
