import { one, stmt } from './model'

/** A sweep that runs once per period (a clinic day, an hour) however often Cron fires: one row read tells a minute it has nothing to do. */
export const ranIn = async (db: D1Database, job: string, period: string) => (await one(db, 'SELECT period FROM bm_job_runs WHERE job=?', job))?.period === period
/** Record the period in the batch that finishes the sweep, so a sweep that fails part-way runs again next minute. */
export const markRan = (db: D1Database, job: string, period: string) => stmt(db, 'INSERT INTO bm_job_runs(job,period) VALUES(?,?) ON CONFLICT(job) DO UPDATE SET period=excluded.period', job, period)
