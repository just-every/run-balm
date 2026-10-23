import { insist } from '../domain/model'
/** ZIP central-directory parsing. Members are streamed through the platform's
 * DEFLATE decoder; neither executables nor paths are written to disk. */
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
export type Member = { name: string; chunks: () => AsyncGenerator<string> }
export function zipMembers(bytes: Uint8Array): Member[] {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let end=-1
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(view.getUint32(p,true)===0x06054b50){end=p;break}
  insist(end>=0,'cms_download_is_not_a_zip_archive')
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true)
  insist(count>0&&count<1000&&offset<bytes.length,'unsupported_zip_directory')
  const entries:Member[]=[];let p=offset
  for(let n=0;n<count;n++) {
    insist(p+46<=bytes.length&&view.getUint32(p,true)===0x02014b50,'invalid_zip_directory')
    const expectedCrc=view.getUint32(p+16,true)
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),size=view.getUint32(p+20,true),expanded=view.getUint32(p+24,true),nameLength=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true)
    const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLength));p+=46+nameLength+extra+comment
    insist(!(flags&1)&&[0,8].includes(method)&&expanded<=200_000_000,'unsupported_or_oversized_zip_member')
    insist(local+30<=bytes.length&&view.getUint32(local,true)===0x04034b50,'invalid_zip_member')
    const begin=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true)
    insist(begin+size<=bytes.length,'truncated_zip_member')
    entries.push({name,async *chunks(){
      let stream:ReadableStream<Uint8Array>=new Blob([bytes.slice(begin,begin+size).buffer as ArrayBuffer]).stream()
      if(method===8)stream=stream.pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array,Uint8Array>) as ReadableStream<Uint8Array>
      const reader=stream.getReader(),decoder=new TextDecoder('windows-1252');let total=0,crc=0xffffffff
      try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;for(const byte of value)crc=crcTable[(crc^byte)&255]^(crc>>>8);insist(total<=expanded&&total<=200_000_000,'expanded_zip_size_mismatch');yield decoder.decode(value,{stream:true})}yield decoder.decode();insist(total===expanded,'expanded_zip_size_mismatch');insist(((crc^0xffffffff)>>>0)===expectedCrc,'zip_member_checksum_mismatch')}finally{await reader.cancel();reader.releaseLock()}
    }})
  }
  return entries
}
