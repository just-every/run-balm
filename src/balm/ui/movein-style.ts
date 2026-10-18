export const moveinStyle = `
.movein-preview{overflow-wrap:anywhere}
@media(max-width:600px){
.movein-records,.movein-records tbody{display:block;width:100%}
.movein-records thead{display:none}
.movein-records tr{display:block;padding:14px 0;border-bottom:1px solid var(--line)}
.movein-records td{display:block;width:100%;padding:0 0 10px;border:0}
.movein-records td::before{content:attr(data-label);display:block;margin:0 0 3px;color:var(--soft);font-size:12px;font-weight:600}
.movein-records td:last-child{padding-bottom:0}
}
`
