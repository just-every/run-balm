// Page-level touches beyond the shared cards and forms: the file and list
// headings, the waitlist and the clinic's staff rows. Tokens only.
export const pagesStyle = `
#content>h1:first-child,#content>.notice+h1{margin-top:2px}
#content>h1+p{margin-bottom:22px}
.file-head{display:flex;align-items:center;gap:16px;margin:0 0 22px}.file-head h1{margin:0}.file-head p{margin:4px 0 0;font-size:14px}.file-head .avatar.lg{width:60px;height:60px;font-size:19px}
.client-list li{display:flex;align-items:center;gap:12px}.client-list li a{font-weight:600;color:var(--ink);text-decoration:none}.client-list li a:hover{text-decoration:underline}
.client-list .avatar{width:30px;height:30px;font-size:11px}
`
