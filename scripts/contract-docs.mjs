// Preserve both adopted documentation projections from the concurrent slices.
import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {parseContract} from '../src/base/seed-contract.mjs'

{
// Keep selected clause projections and the shared counts derived from CONTRACT.md.



const [mode='check',...requested]=process.argv.slice(2)
const ids=[...new Set(['INS-002','AGENT-005','HIPAA-005','SCHED-005','REPORT-003','PAY-003','PAY-002','PAY-008','AGENT-004','MOVE-006','COMM-002',...requested.filter(id=>!['CHART-011','COMM-003'].includes(id)&&!id.startsWith('BASE-AGENT-'))])]
assert.ok(['write','check'].includes(mode)&&ids.length,'Usage: contract-docs.mjs write|check CLAUSE...')
const source=readFileSync('CONTRACT.md','utf8')
const rows=source.split('\n').filter(line=>/^\| `[A-Z][A-Z0-9-]+` \|/.test(line)).map(line=>{const cells=line.split('|').slice(1,-1).map(cell=>cell.trim());return [line,cells[0].replaceAll('`',''),...cells.slice(1)]}).filter(row=>['published','target','push-further'].includes(row[3])&&['done','partial','missing'].includes(row[4]))
const counts=selected=>['done','partial','missing'].map(status=>selected.filter(r=>r[4]===status).length)
let contract=source
for(const [label,selected] of [['Published',rows.filter(r=>r[3]==='published')],['Target and push further',rows.filter(r=>r[3]!=='published')],['All',rows]]){
 const values=counts(selected)
 contract=contract.replace(new RegExp('^\\| '+label+' \\|.*$','m'),'| '+label+' | '+[...values,selected.length].join(' | ')+' |')
}
let acceptance=readFileSync('ACCEPTANCE.md','utf8')
const riderTitle='## PAY-008 and AGENT-005 adopted-default riders'
const riderStart=source.indexOf(riderTitle),riderEnd=source.indexOf('\n## ',riderStart+1)
const projectionStart=acceptance.indexOf(riderTitle),projectionEnd=acceptance.indexOf('\n## ',projectionStart+1)
assert.ok(riderStart>=0&&riderEnd>riderStart&&projectionStart>=0&&projectionEnd>projectionStart,'Adopted rider section is missing')
acceptance=acceptance.slice(0,projectionStart)+source.slice(riderStart,riderEnd)+acceptance.slice(projectionEnd)
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

}

{
// Incremental generation for contract clauses adopted by this seed. Existing
// acceptance narratives and homepage claims outside the marked blocks stay intact.



const mode=process.argv[2]
if(!['write','check'].includes(mode))throw Error('Use write or check')
const files=new Map(['CONTRACT.md','ACCEPTANCE.md','docs/CLAIMS.md'].map(p=>[p,readFileSync(p,'utf8')]))
const before=new Map(files)
let source=files.get('CONTRACT.md')
const statusRows=source.split('\n').filter(l=>/^\| `[A-Z][A-Z0-9-]+` \|/.test(l)).map(l=>l.split('|').slice(1,-1).map(c=>c.trim())).filter(c=>['done','partial','missing'].includes(c[3]))
const counts=(rows)=>['done','partial','missing'].map(s=>rows.filter(r=>r[3]===s).length)
const summary=(label,rows)=>`| ${label} | ${counts(rows).join(' | ')} | ${rows.length} |`
for(const [label,rows] of [['Published',statusRows.filter(r=>r[2]==='published')],['Target and push further',statusRows.filter(r=>r[2]!=='published')],['All',statusRows]])source=source.replace(new RegExp('^\\| '+label+' \\|.*$','m'),summary(label,rows))
files.set('CONTRACT.md',source)
const contract=parseContract(source)
// The registry limits this gradual migration to adopted clauses. A following
// round can add another id without regenerating unrelated legacy prose.
const adopted=['CHART-011',...statusRows.filter(row=>row[0].startsWith('`BASE-AGENT-')).map(row=>row[0].replaceAll('`',''))]
let acceptance=files.get('ACCEPTANCE.md')
const [done,partial,missing]=counts(statusRows)
acceptance=acceptance.replace(/Its current counts are: \d+ done, \d+ partial and \d+ missing of \d+ clauses\./,`Its current counts are: ${done} done, ${partial} partial and ${missing} missing of ${statusRows.length} clauses.`)
for(const id of adopted){
 const c=contract.clauses.find(c=>c.id===id)
 if(!c)throw Error('Clause is absent: '+id)
 const row=statusRows.find(r=>r[0]==='`'+id+'`')
 const block=`<!-- contract-docs:begin ${id} -->\n- **${id} — ${c.title}** (${c.status}). ${c.text.replace(/patient\x2fepisode/g,'patient and episode')} Evidence: ${row[4] || 'None yet.'} Gap: ${c.gap || 'None.'}\n<!-- contract-docs:end ${id} -->`
 const marked=new RegExp('<!-- contract-docs:begin '+id+' -->[\\s\\S]*?<!-- contract-docs:end '+id+' -->')
 if(marked.test(acceptance))acceptance=acceptance.replace(marked,block)
 else {
  const legacy=new RegExp('^- \\*\\*'+id+' — [^\\n]*$','m')
  if(!legacy.test(acceptance)){if(!id.startsWith('BASE-AGENT-'))throw Error('Acceptance entry is absent: '+id);acceptance=acceptance.trimEnd()+'\n\n'+block+'\n'}
  else acceptance=acceptance.replace(legacy,block)
 }
}
files.set('ACCEPTANCE.md',acceptance)
const begin='<!-- contract-docs:begin -->',end='<!-- contract-docs:end -->'
const register=begin+'\n## Adopted contract evidence\n\nGenerated from the Status table in CONTRACT.md; this register makes no additional homepage claim.\n\n| Clause | Status | Evidence | Gap |\n| --- | --- | --- | --- |\n'+adopted.map(id=>{const row=statusRows.find(r=>r[0]==='`'+id+'`');return `| ${row[0]} | ${row[3]} | ${row[4]} | ${row[5]} |`}).join('\n')+'\n'+end
let claims=files.get('docs/CLAIMS.md')
claims=claims.includes(begin)?claims.replace(new RegExp(begin+'[\\s\\S]*?'+end),register):claims.trimEnd()+'\n\n'+register+'\n'
files.set('docs/CLAIMS.md',claims)
for(const [path,value] of files){
 if(mode==='write')writeFileSync(path,value)
 else if(value!==before.get(path))throw Error('Generated contract documentation is stale: '+path)
}
console.log('contract-docs '+mode+': '+adopted.join(', ')+'; '+done+' done, '+partial+' partial, '+missing+' missing')

}

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
const ids=['COMM-003']
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
