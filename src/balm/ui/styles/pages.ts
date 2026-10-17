// Page layouts: the schedule's head with its notes card, the calendar card and
// the panels under it; the client file's two columns; the clinic's service and
// staff rows; the client list; and the public pages' single column.
export const pagesStyle = `
.rer-themed .page-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,880px);gap:20px 40px;align-items:start;margin:0 0 20px}
.rer-themed .page-head>div>p{font-size:16px;margin:6px 0 0}
.rer-themed .page-head .panel{margin:0;padding:16px 20px 14px}
.rer-themed .notes-due>h2{margin-bottom:4px}
.rer-themed .notes-due .help{margin:0 0 6px}
.rer-themed .due{list-style:none;margin:0;padding:0}
.rer-themed .due li{display:grid;grid-template-columns:28px max-content minmax(0,1fr) max-content auto;gap:4px 14px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:13px;color:var(--body)}.rer-themed .due li>span:nth-of-type(3){white-space:nowrap}
.rer-themed .due li:first-child{border-top:0}
.rer-themed .due .avatar{width:28px;height:28px;font-size:10.5px}
.rer-themed .due a{color:var(--ink);font-weight:500;text-decoration:none}.rer-themed .due a:hover{text-decoration:underline}
.rer-themed .due .status{margin:0;justify-self:end}
.rer-themed .notes-due details{margin-top:4px}.rer-themed .notes-due details[open]>summary{margin-bottom:0}
.rer-themed .cal-panels{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:20px;align-items:start}
.rer-themed .cal-side>.panel,.rer-themed .cal-side>div>.panel{margin:0 0 20px}
.rer-themed .cal-panels>.panel{margin:0}
.rer-themed .panel-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;margin:0 0 10px}
.rer-themed .panel-head h2{margin:0}.rer-themed .panel-head p{margin:0}
.rer-themed .visit-row{display:grid;grid-template-columns:34px minmax(220px,1fr) minmax(0,max-content) max-content;gap:4px 16px;align-items:center;padding:12px 0}
.rer-themed .visit-row h3{margin:0;font-size:14.5px}.rer-themed .visit-row .help{margin:0}
.rer-themed .visit-row .chips{margin:0;justify-content:flex-end}.rer-themed .visit-row .chips .status{margin:2px 0 2px 6px}
.rer-themed .visit-row .visit-links{margin:0;font-size:13.5px;white-space:nowrap}
.rer-themed .visit-row>:nth-child(n+5){grid-column:2/-1}.rer-themed .visit-row form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.rer-themed .visit-row button{min-height:34px;padding:0 16px;font-size:13.5px}
.rer-themed .file-title{display:flex;align-items:center;gap:18px;margin:0 0 22px}
.rer-themed .file-title h1{margin:0}
.rer-themed .back{display:inline-flex;align-items:center;gap:6px;margin:0 0 10px;font-size:14px;color:var(--soft);text-decoration:none}.rer-themed .back::before{content:'';width:6px;height:6px;border:solid currentColor;border-width:0 0 1.6px 1.6px;transform:rotate(45deg)}
.rer-themed .file{display:grid;grid-template-columns:minmax(300px,4fr) minmax(0,9fr);gap:20px;align-items:start}
.rer-themed .file>div>.panel{margin:0 0 20px}.rer-themed .file-side dl.answers{grid-template-columns:minmax(0,1fr);gap:2px}
.rer-themed .facts-list{list-style:none;margin:0 0 12px;padding:0}
.rer-themed .facts-list li{display:flex;gap:12px;align-items:center;padding:4px 0;color:var(--ink)}
.rer-themed .facts-list svg{flex:none;width:18px;height:18px;color:var(--soft)}
.rer-themed .appt-row{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:6px 20px;align-items:start}
.rer-themed .appt-row .when{color:var(--ink);font-size:14px;font-variant-numeric:tabular-nums}
.rer-themed .appt-row h3{font-weight:500;font-size:14.5px;margin:0 0 6px}
.rer-themed .appt-row .actions{justify-content:flex-end;align-items:flex-start;flex-direction:column;gap:6px}
.rer-themed .appt-row .actions>*{margin:0}
.rer-themed .appt-row details[open]{grid-column:1/-1}
.rer-themed .rows .entry{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 16px;align-items:baseline;padding:11px 0}
.rer-themed .rows .entry>h3{margin:0;font-size:14.5px}.rer-themed .rows .entry>p{grid-column:1;margin:0;font-size:13.5px}
.rer-themed .rows .entry>details{grid-column:2;grid-row:1;margin:0;justify-self:end}.rer-themed .rows .entry>details[open]{grid-column:1/-1;grid-row:auto;justify-self:stretch;margin-top:8px}
.rer-themed .staff .entry{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);grid-auto-flow:row dense;gap:4px 28px;align-items:start}
.rer-themed .staff .entry>*{grid-column:3;margin:0 0 6px}
.rer-themed .staff .entry>h3,.rer-themed .staff .entry>p:first-of-type{grid-column:1}
.rer-themed .staff .entry>ul,.rer-themed .staff .entry>.empty{grid-column:2;grid-row:1/span 4;font-size:13.5px}
.rer-themed .staff .entry>ul li{padding:3px 0;border:0}
.rer-themed .staff .entry>details[open]{grid-column:1/-1}
.rer-themed .staff .entry>form{justify-self:start}
.rer-themed form:has(>fieldset.hours-day){grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));align-items:start}
.rer-themed form:has(>fieldset.hours-day)>:not(fieldset){grid-column:1/-1}
.rer-themed fieldset.hours-day{margin:0}
.rer-themed .client-list{list-style:none;margin:0;padding:0}
.rer-themed .client-list li{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}.rer-themed .client-list li:first-child{border-top:0}
.rer-themed .client-list a{color:var(--ink);font-weight:500;text-decoration:none}.rer-themed .client-list a:hover{text-decoration:underline}
.rer-themed .client-list .help{margin-left:auto}
.rer-themed .clients-grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,4fr);gap:20px;align-items:start}
.rer-themed .clients-grid>.panel{margin:0}
.rer-themed main.public .app-header{margin-bottom:18px}
.rer-themed main.public>.panel,.rer-themed main.public section.panel{margin-bottom:18px}
@media(max-width:1100px){.rer-themed .page-head,.rer-themed .cal-panels,.rer-themed .file,.rer-themed .clients-grid{grid-template-columns:minmax(0,1fr)}}
@media(max-width:1100px){.rer-themed .file{display:flex;flex-direction:column;gap:0}.rer-themed .file-side,.rer-themed .file-main{display:contents}.rer-themed .file .panel{order:2}.rer-themed .file-side>.panel:first-child{order:0}.rer-themed .file-main>.panel{order:1}}
@media(max-width:700px){
.rer-themed .page-head{margin-bottom:16px}
.rer-themed .due li{grid-template-columns:28px minmax(0,1fr) auto;gap:0 12px;padding:8px 0}
.rer-themed .due li>a{grid-column:2}.rer-themed .due li>span:not(.avatar):not(.status){grid-column:2;font-size:12.5px;color:var(--soft)}
.rer-themed .due .avatar{grid-row:1/span 3}.rer-themed .due .status{grid-column:3;grid-row:1}
.rer-themed .visit-row{grid-template-columns:34px minmax(0,1fr)}.rer-themed .visit-row .chips{grid-column:2;justify-content:flex-start}.rer-themed .visit-row .chips .status{margin:2px 6px 2px 0}.rer-themed .visit-row .visit-links{grid-column:2}
.rer-themed .file-title{gap:12px}.rer-themed .avatar.big{width:48px;height:48px;font-size:16px}
.rer-themed .appt-row{grid-template-columns:minmax(0,1fr)}.rer-themed .appt-row .actions{align-items:stretch}
.rer-themed .staff .entry{display:block}
}
`
