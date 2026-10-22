import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','elapsed-time proof requires a clean committed candidate')
execFileSync(process.execPath,['--test','--test-name-pattern=SEC-001','tests/security.test.mjs'],{stdio:'inherit',env:{...process.env,BALM_REAL_IDLE:'1'}})
console.log('PASS SEC-001 elapsed idle journey head='+head+' run=sx-balm-c28-security-'+head)
