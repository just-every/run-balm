export const auditStyle = `
@media(max-width:600px){
.audit-table,.audit-table tbody{display:block;width:100%}
.audit-table thead{display:none}
.audit-table tr{display:block;padding:14px 0;border-bottom:1px solid var(--line)}
.audit-table td{display:block;width:100%;padding:0 0 10px;border:0;overflow-wrap:anywhere}
.audit-table td::before{content:attr(data-label);display:block;margin:0 0 3px;color:var(--soft);font-size:12px;font-weight:600}
.audit-table td:last-child{padding-bottom:0}
}
`
