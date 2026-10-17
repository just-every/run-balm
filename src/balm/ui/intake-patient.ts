import { CONSENT_TEXT, CONSENT_VERSION } from '../intake/input'
import { field, h, hidden, select } from './shared'

/** Insert immediately before the intake submit button. The containing form uses multipart/form-data. */
export function intakePatientEnhancement(_data?: unknown) {
  return `<fieldset><legend>Insurance (optional)</legend><p>If you are using insurance, enter the policy details and add clear photos of both sides of your card. The clinic checks these details before using them.</p>
    ${field('insurancePayer', 'Payer / insurance company', '', 'text', 'maxlength="150"')}
    ${field('insuranceMemberId', 'Member ID', '', 'text', 'maxlength="100"')}
    ${field('insuranceGroup', 'Group number (if listed)', '', 'text', 'maxlength="100"')}
    ${field('insuranceSubscriber', 'Subscriber’s full name', '', 'text', 'maxlength="150"')}
    ${select('insuranceRelationship', 'Patient’s relationship to subscriber', [['self','Self'],['spouse','Spouse'],['child','Child'],['other','Other']], 'self', '')}
    <label>Card front (JPEG, PNG or WebP; up to 2 MB)<input name="insuranceFront" type="file" accept="image/jpeg,image/png,image/webp"></label>
    <label>Card back (JPEG, PNG or WebP; up to 2 MB)<input name="insuranceBack" type="file" accept="image/jpeg,image/png,image/webp"></label>
    </fieldset><fieldset><legend>Treatment acknowledgment and signature</legend><p>${h(CONSENT_TEXT)}</p><p class="help">Document version: ${h(CONSENT_VERSION)}. Your signature, time, IP address and this form are kept as a fixed PDF in your chart.</p>
    ${hidden('consentVersion', CONSENT_VERSION)}
    ${field('signerName', 'Signer’s full name', '', 'text', 'required maxlength="150" autocomplete="name"')}
    ${select('signerRelationship', 'I am signing as', [['patient','Patient'],['parent','Parent'],['guardian','Guardian']])}
    <label class="check"><input name="consentAccepted" type="checkbox" value="on" required><span>I have read the acknowledgment and intend to sign it.</span></label>
    <p id="signature-help">Draw with your finger, pen or mouse below, or type your signature in the field underneath.</p>
    <canvas id="intake-signature" width="900" height="300" aria-label="Draw your signature" aria-describedby="signature-help" class="intake-signature"></canvas>
    <button type="button" id="intake-signature-clear" class="secondary">Clear drawing</button>
    ${hidden('signature', '')}${field('signatureTyped', 'Or type your signature', '', 'text', 'maxlength="150" autocomplete="off"')}
    <p id="intake-signature-error" role="alert"></p></fieldset>`
}

export const intakePatientStyle = `.public form>fieldset{display:grid;gap:12px;padding:16px}.public fieldset p{margin:0}.intake-signature{display:block;width:100%;max-width:600px;height:200px;border:1px solid var(--field);border-radius:10px;touch-action:none;background:var(--rer-surface)}`

export const intakeSignatureScript = `(()=>{
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
      form.addEventListener('submit',e=>{finish();if(!typed.value.trim()&&strokes.reduce((n,s)=>n+s.length,0)<4){e.preventDefault();error.textContent='Draw or type your signature before sending the form.';typed.focus();return}for(const name of ['insuranceFront','insuranceBack']){const file=form.elements[name].files[0];if(file&&file.size>2097152){e.preventDefault();error.textContent='Each card photo must be 2 MB or smaller.';form.elements[name].focus();return}}});
    })();`
