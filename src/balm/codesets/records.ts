import { insist } from '../domain/model'
/** RFC-4180 records, also used by CMS's quoted tab-separated files. */
export async function* delimited(chunks: AsyncIterable<string>, separator = ','): AsyncGenerator<string[]> {
  let cell='', row:string[]=[], quoted=false, pendingQuote=false
  for await (const chunk of chunks) for (const char of chunk) {
    if (pendingQuote) {
      pendingQuote=false
      if(char==='"'){cell+='"';continue}
      quoted=false
    } else if(quoted) {
      if(char==='"')pendingQuote=true
      else cell+=char
      continue
    }
    if(char==='"' && !cell){quoted=true;continue}
    if(char===separator){row.push(cell);cell='';continue}
    if(char==='\n'){row.push(cell.replace(/\r$/,''));yield row;row=[];cell='';continue}
    cell+=char
  }
  insist(!quoted || pendingQuote,'unterminated_code_file_record')
  if(cell||row.length){row.push(cell.replace(/\r$/,''));yield row}
}
export async function* lines(chunks: AsyncIterable<string>) {
  let rest=''
  for await(const chunk of chunks){rest+=chunk;let at:number;while((at=rest.indexOf('\n'))>=0){yield rest.slice(0,at).replace(/\r$/,'');rest=rest.slice(at+1)}}
  if(rest)yield rest.replace(/\r$/,'')
}
export async function* oneText(value: string){yield value}
export const headerKey=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'')
