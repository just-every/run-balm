import {field,hidden} from './shared'

export function contributorFields(){
 return hidden('contributorsForm','on')+'<details><summary>Add a contributing provider’s written quote</summary><p>Include another provider only after receiving their written, coded estimate. Record its identifiers and reference exactly. No request or patient information is sent to them.</p>'+Array.from({length:2},(_,i)=>{
  const key='contributor_'+i+'_'
  return '<fieldset><legend>Contributing provider '+(i+1)+'</legend>'+field(key+'name','Provider or facility name')+field(key+'npi','NPI','','text','maxlength="10"')+field(key+'taxId','Tax ID','','text','maxlength="12"')+field(key+'address','Provider address')+field(key+'sourceReference','Written quote reference')+field(key+'receivedOn','Quote received on','','date')+field(key+'diagnosisCodes','Diagnosis codes from the quote')+Array.from({length:2},(_,n)=>{const line=key+'line_'+n+'_';return '<fieldset><legend>Quoted service '+(n+1)+'</legend>'+field(line+'name','Service description')+field(line+'code','Service code','','text','maxlength="5"')+field(line+'quantity','Expected quantity','','number','min="1" max="365"')+field(line+'price','Quoted unit charge ($)','','text','inputmode="decimal"')+'</fieldset>'}).join('')+`<label class="check"><input name="${key}attest" type="checkbox" value="on"><span>I checked this provider’s written quote, including the expected services, codes, quantities and charges.</span></label></fieldset>`
 }).join('')+'</details>'
}
