// Keep selected clause projections and the shared counts derived from CONTRACT.md.
import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'

const [mode,...ids]=process.argv.slice(2)
assert.ok(['write','check'].includes(mode)&&ids.length,'Usage: contract-docs.mjs write|check CLAUSE...')
const source=readFileSync('CONTRACT.md','utf8')
const rows=[...source.matchAll(/^\| `([A-Z]+-\d+)` \| (.*?) \| (published|target|push-further) \| (done|partial|missing) \| (.*?) \| (.*?) \|$/gm)]
const counts=selected=>['done','partial','missing'].map(status=>selected.filter(r=>r[4]===status).length)
let contract=source
for(const [label,selected] of [['Published',rows.filter(r=>r[3]==='published')],['Target and push further',rows.filter(r=>r[3]!=='published')],['All',rows]]){
 const values=counts(selected)
 contract=contract.replace(new RegExp('^\\| '+label+' \\|.*$','m'),'| '+label+' | '+[...values,selected.length].join(' | ')+' |')
}
let acceptance=readFileSync('ACCEPTANCE.md','utf8')
const all=counts(rows)
acceptance=acceptance.replace(/Its current counts are: \d+ done, \d+ partial and \d+ missing of \d+ clauses\./,`Its current counts are: ${all[0]} done, ${all[1]} partial and ${all[2]} missing of ${rows.length} clauses.`)
for(const row of rows)acceptance=acceptance.replace(new RegExp('(^- \\*\\*'+row[1]+' — .*?\\*\\* \\()\\w+(\\)\\.)','m'),'$1'+row[4]+'$2')
const projections=ids.map(id=>{
 const row=rows.find(r=>r[1]===id);assert.ok(row,'Unknown clause '+id)
 const definition=source.split('\n').find(line=>line.startsWith('- **'+id+' — '));assert.ok(definition)
 const evidence=definition.split('**Acceptance evidence:** ')[1];assert.ok(evidence)
 const projected=`- **${id} — ${row[2]}** (${row[4]}). ${evidence} Evidence: ${row[5]}${row[6]?' Gap: '+row[6]:''}`
 acceptance=acceptance.replace(new RegExp('^- \\*\\*'+id+' — .*$', 'm'),()=>projected)
 return row[0]
})
let claims=readFileSync('docs/CLAIMS.md','utf8')
const start='<!-- contract-generated:start -->',end='<!-- contract-generated:end -->'
const generated=start+'\n## Generated clause status\n\nProduct status derived from CONTRACT.md; homepage claims above retain their own scope.\n\n| Clause | Title | Kind | Status | Evidence | Gap |\n| --- | --- | --- | --- | --- | --- |\n'+projections.join('\n')+'\n'+end
claims=claims.includes(start)?claims.replace(new RegExp(start+'[\\s\\S]*?'+end),()=>generated):claims.trimEnd()+'\n\n'+generated+'\n'
for(const [path,value] of [['CONTRACT.md',contract],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]){
 if(mode==='write')writeFileSync(path,value)
 else assert.equal(readFileSync(path,'utf8'),value,path+' needs contract-docs write')
}
console.log('contract-docs '+mode+' passed: '+ids.join(', '))
