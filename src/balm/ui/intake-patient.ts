import { insuranceCapture, insuranceCaptureScript } from './intake-insurance'
import { patientPolicies } from './consents'
import { field, h, hidden, select } from './shared'

/** Insert immediately before the intake submit button. The containing form uses multipart/form-data. */
export function intakePatientEnhancement(data: any) {
  return insuranceCapture(data) + patientSignature(data.policies)
}

export function patientSignature(policies: any[]) {
  if (!policies.length) return ''
  return `${patientPolicies(policies)}<fieldset><legend>Your signature</legend><p>Your signature, signer relationship, time, IP address and each accepted document’s exact version are kept in a fixed PDF on the chart.</p>
    ${field('signerName', 'Signer’s full name', '', 'text', 'required maxlength="150" autocomplete="name"')}
    ${select('signerRelationship', 'I am signing as', [['patient','Patient'],['parent','Parent'],['guardian','Guardian']])}
    
    <p id="signature-help">Draw with your finger, pen or mouse below, or type your signature in the field underneath.</p>
    <canvas id="intake-signature" width="900" height="300" aria-label="Draw your signature" aria-describedby="signature-help" class="intake-signature"></canvas>
    <button type="button" id="intake-signature-clear" class="secondary">Clear drawing</button>
    ${hidden('signature', '')}${field('signatureTyped', 'Or type your signature', '', 'text', 'maxlength="150" autocomplete="off"')}
    <p id="intake-signature-error" role="alert"></p></fieldset>`
}

export const intakePatientStyle = `.public form>fieldset{display:grid;gap:12px;padding:16px}.public fieldset p{margin:0}.intake-signature{display:block;width:100%;max-width:600px;height:200px;border:1px solid var(--field);border-radius:10px;touch-action:none;background:var(--rer-surface)}`

export const intakeSignatureScript = insuranceCaptureScript + `(()=>{
      const canvas=document.getElementById('intake-signature');if(!canvas)return;
      const form=canvas.closest('form'),ctx=canvas.getContext('2d'),saved=form.elements.signature,typed=form.elements.signatureTyped,error=document.getElementById('intake-signature-error');
      let strokes=[],active=null;ctx.strokeStyle='#142232';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
      const point=e=>{const r=canvas.getBoundingClientRect();return[Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]};
      canvas.addEventListener('pointerdown',e=>{if(strokes.length>=80)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);active=[point(e)];strokes.push(active);typed.value='';error.textContent=''});
      canvas.addEventListener('pointermove',e=>{if(!active)return;e.preventDefault();if(strokes.reduce((n,s)=>n+s.length,0)>=4000)return;const p=point(e),last=active[active.length-1];if(Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<0.002)return;active.push(p);ctx.beginPath();ctx.moveTo(last[0]*canvas.width,last[1]*canvas.height);ctx.lineTo(p[0]*canvas.width,p[1]*canvas.height);ctx.stroke()});
      const finish=()=>{if(active&&active.length<2)strokes.pop();active=null;saved.value=JSON.stringify(strokes)};
      canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
      document.getElementById('intake-signature-clear').addEventListener('click',()=>{strokes=[];active=null;saved.value='';ctx.clearRect(0,0,canvas.width,canvas.height)});
      typed.addEventListener('input',()=>{if(typed.value.trim()){strokes=[];saved.value='';ctx.clearRect(0,0,canvas.width,canvas.height)}});
      form.addEventListener('submit',e=>{finish();if(!typed.value.trim()&&strokes.reduce((n,s)=>n+s.length,0)<4){e.preventDefault();error.textContent='Draw or type your signature before sending the form.';typed.focus();return}for(const control of form.querySelectorAll('input[type=file]')){const file=control.files[0];if(file&&file.size>1900000){e.preventDefault();error.textContent='Each photo must be 1.9 MB or smaller.';control.focus();return}}});
    })();`
