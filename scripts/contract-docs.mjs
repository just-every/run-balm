// Keep selected clause projections and the shared counts derived from CONTRACT.md.
import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'

const [mode='check',...requested]=process.argv.slice(2)
const ids=[...new Set(['REPORT-003',...requested.filter(id=>id!=='COMM-003')])]
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

{


// Incremental adoption keeps the existing acceptance and homepage claim text intact.
// Only explicitly selected status rows acquire generated evidence registers.
const [mode='check',...selected]=process.argv.slice(2)
if(!['write','check'].includes(mode))throw Error('Expected write or check')
const contract=readFileSync('CONTRACT.md','utf8')
const rows=new Map(contract.split('\n').filter(line=>/^\| `[A-Z]+-\d+` \|/.test(line)).map(line=>{
 const cells=line.split('|').slice(1,-1).map(cell=>cell.trim())
 return [cells[0].replaceAll('`',''),{title:cells[1],status:cells[3],evidence:cells[4],gap:cells[5]}]
}))
const ids=selected.length?selected.filter(id=>id==='COMM-003'):[...readFileSync('ACCEPTANCE.md','utf8').matchAll(/<!-- contract-status:([A-Z]+-\d+):start -->/g)].map(m=>m[1])
for(const file of ['ACCEPTANCE.md','docs/CLAIMS.md']){
 let value=readFileSync(file,'utf8')
 for(const id of ids){
  const row=rows.get(id)
  if(!row)throw Error('Unknown contract clause '+id)
  const start='<!-- contract-status:'+id+':start -->',end='<!-- contract-status:'+id+':end -->'
  const generated=start+'\n**'+id+' — '+row.title+'** ('+row.status+'). Evidence: '+row.evidence+'. Gap: '+(row.gap||'None.')+'\n'+end
  const at=value.indexOf(start),until=value.indexOf(end)
  if(at!==-1){if(until<at)throw Error('Incomplete generated register in '+file);value=value.slice(0,at)+generated+value.slice(until+end.length)}
  else if(file==='ACCEPTANCE.md'){
   const lines=value.split('\n'),index=lines.findIndex(line=>line.startsWith('- **'+id+' — '))
   if(index<0)throw Error('Acceptance entry missing for '+id)
   lines[index]=lines[index].replace(/\((done|partial|missing)\)\./,'('+row.status+').')
   lines.splice(index+1,0,'',generated)
   value=lines.join('\n')
  }else value=value.trimEnd()+'\n\n'+generated+'\n'
 }
 const original=readFileSync(file,'utf8')
 if(mode==='write'){if(value!==original)writeFileSync(file,value)}
 else if(value!==original)throw Error('Stale generated status register: '+file)
}
console.log('Contract status registers '+mode+' passed: '+ids.join(', '))

}
