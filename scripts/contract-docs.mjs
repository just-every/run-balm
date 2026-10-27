import {readFileSync,writeFileSync} from 'node:fs'

// Incremental adoption keeps the existing acceptance and homepage claim text intact.
// Only explicitly selected status rows acquire generated evidence registers.
const [mode='check',...selected]=process.argv.slice(2)
if(!['write','check'].includes(mode))throw Error('Expected write or check')
const contract=readFileSync('CONTRACT.md','utf8')
const rows=new Map(contract.split('\n').filter(line=>/^\| `[A-Z]+-\d+` \|/.test(line)).map(line=>{
 const cells=line.split('|').slice(1,-1).map(cell=>cell.trim())
 return [cells[0].replaceAll('`',''),{title:cells[1],status:cells[3],evidence:cells[4],gap:cells[5]}]
}))
const ids=selected.length?selected:[...readFileSync('ACCEPTANCE.md','utf8').matchAll(/<!-- contract-status:([A-Z]+-\d+):start -->/g)].map(m=>m[1])
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
