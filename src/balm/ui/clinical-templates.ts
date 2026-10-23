import { bodyRegions } from '../charting/template-elements'
import { templates } from '../charting/templates'
import { field, form, h, hidden, panel, select, textarea } from './shared'

function fields(t?: any) {
  const baseKey = t ? `${t.discipline}.${t.kind}` : 'pt.evaluation'
  const base = templates.find(x=>x.key===baseKey)
  const extra = t?.sections.filter((s:any)=>!base?.sections.some(x=>x.id===s.id)) ?? []
  return (t ? hidden('id',t.key)+hidden('version',t.version) : '') + select('baseKey','Discipline and note type',templates.map(t=>[t.key,t.title]),baseKey)
    + field('title','Template name',t?.title ?? '','text','required maxlength="120"')
    + select('bodyRegion','Body region',bodyRegions.map(x=>[x,x]),t?.bodyRegion ?? 'General')
    + field('diagnosisVariant','Diagnosis variant',t?.diagnosisVariant ?? '','text','maxlength="200" placeholder="For example, post-operative knee or aphasia"')
    + `<h4>Practice elements and pick lists</h4><p class="help">The discipline’s required elements stay in place. Add fields for your practice; one choice per line makes a pick list.</p>${Array.from({length:Math.min(16,Math.max(3,extra.length+1))},(_,n)=>{
      const e=extra[n]
      return `<details${e ? ' open' : ''}><summary>Practice element ${n+1}${e ? ': '+h(e.label) : ''}</summary>${field(`custom_${n}_id`,'Stable field name',e?.id ?? '','text','maxlength="50" pattern="[a-z][a-z0-9_]*" placeholder="For example, transfer_assistance"')}${field(`custom_${n}_label`,'Label',e?.label ?? '','text','maxlength="120"')}${field(`custom_${n}_help`,'Prompt',e?.help ?? '','text','maxlength="500"')}${textarea(`custom_${n}_choices`,'Pick list choices (one per line)',e?.choices?.join('\n') ?? '','maxlength="6000"')}<label class="check"><input type="checkbox" name="custom_${n}_required" value="on"${e?.required?' checked':''}><span>Required before signing</span></label></details>`
    }).join('')}`
}
export function clinicalTemplatesPanel(s: any) {
  if (s.actor.role !== 'owner') return ''
  const custom = (s.clinicalTemplates ?? []).filter((t:any)=>!templates.some(x=>x.key===t.key))
  return panel('Clinical templates','<p>Choose a discipline, body region and diagnosis variant. Saving creates a new version for future notes. Existing notes keep the version they started with.</p>'
    + custom.map((t:any)=>`<details><summary>${h(t.title)} · version ${h(t.version)} · ${h(t.bodyRegion)}${t.diagnosisVariant?' · '+h(t.diagnosisVariant):''}</summary>${form('template.save','/app/clinic',fields(t),'Save a new version')}</details>`).join('')
    + `<details><summary>Add a practice template</summary>${form('template.save','/app/clinic',fields(),'Create template')}</details>`)
}
