/** These are UI phrases only. Patient messages, clinic-authored instructions,
 * names and clinical records are never passed through this dictionary. */
const es:Record<string,string>={
 'Daily':'Diariamente','Your care':'Su atención','Upcoming visits':'Próximas citas','Intake forms':'Formularios de admisión','Home program':'Programa en casa','Messages':'Mensajes','Statements':'Estados de cuenta','Sign out':'Cerrar sesión','Private portal':'Portal privado','Skip to content':'Saltar al contenido',
 'Your next visit and home program, together.':'Su próxima cita y su programa en casa, juntos.','Welcome':'Te damos la bienvenida','Menu':'Menú',
 'Your next visits':'Sus próximas citas','Home exercise program':'Programa de ejercicios en casa','Statements and payments':'Estados de cuenta y pagos','Past visits':'Citas anteriores',
 'Follow your clinician’s instructions. Mark each exercise done when you finish.':'Siga las instrucciones de su terapeuta. Marque cada ejercicio como completado al terminar.',
 'Download printable program PDF':'Descargar programa imprimible en PDF','Mark done':'Marcar como completado','Done today':'Completado hoy',
 'Session date':'Fecha de la sesión','Pain (0–10, optional)':'Dolor (0–10, opcional)','sets':'series','reps':'repeticiones','Hold':'Mantener','seconds':'segundos',
 'No upcoming visits.':'No hay próximas citas.','Book a follow-up':'Reservar una cita de seguimiento','Complete intake form':'Completar formulario de admisión','You have no intake forms to complete.':'No tiene formularios de admisión pendientes.',
 'Your clinician has not assigned a home program yet.':'Su terapeuta aún no le ha asignado un programa en casa.',
 'Your patient record':'Su expediente','Request my record':'Solicitar mi expediente','Requested':'Solicitado','Ready to download':'Listo para descargar','Download record PDF':'Descargar expediente en PDF','Download FHIR record':'Descargar expediente FHIR',
 'Your children\'s portals':'Portales de sus hijos','Child':'Menor','Open child portal':'Abrir portal del menor',
 'Contact and insurance updates':'Actualizaciones de contacto y seguro','Update contact details':'Actualizar datos de contacto','Update insurance details':'Actualizar datos del seguro','New email address':'Nueva dirección de correo electrónico','New phone number':'Nuevo número de teléfono',
 'Send contact update':'Enviar actualización de contacto','Send insurance update':'Enviar actualización del seguro','Insurance payer':'Aseguradora','Member ID':'Número de miembro','Group number':'Número de grupo','Subscriber name':'Nombre del titular','Relationship to subscriber':'Relación con el titular',
 'Self':'Yo misma persona','Spouse':'Cónyuge','Other':'Otra','Parent':'Padre o madre','Legal guardian':'Tutor legal',
 'Send to':'Enviar a','Front desk — scheduling and billing':'Recepción — citas y facturación','Message your care team':'Escriba a su equipo de atención','Send secure message':'Enviar mensaje seguro',
 'This inbox is not for emergencies. For an emergency, call 911. The clinic may not read messages immediately.':'Este buzón no es para emergencias. En caso de emergencia, llame al 911. Es posible que la clínica no lea los mensajes de inmediato.',
 'Your care team':'Su equipo de atención','No messages yet. Write to your clinic below.':'Aún no hay mensajes. Escriba a su clínica abajo.',
 'Download statement PDF':'Descargar estado de cuenta en PDF','balance':'saldo','Pay balance':'Pagar saldo','Manage payment card':'Administrar tarjeta de pago',
 'Your patient portal':'Su portal del paciente','Open your patient portal':'Abrir su portal del paciente','Email address':'Correo electrónico','Email me a sign-in link':'Enviarme un enlace de acceso','Sign in to my portal':'Entrar a mi portal',
 'Use the email address on your patient file. We’ll email you a private link to sign in.':'Use el correo electrónico de su expediente. Le enviaremos un enlace privado para iniciar sesión.',
 'Continue to your private visits, forms, home program, messages and statements.':'Continúe a sus citas, formularios, programa en casa, mensajes y estados de cuenta privados.',
 'Need to change your email? Contact your clinic.':'¿Necesita cambiar su correo electrónico? Comuníquese con su clínica.',
 'Sign in by text message':'Iniciar sesión por mensaje de texto','Mobile number':'Número de móvil','Text me a code':'Enviarme un código','Sign-in code':'Código de acceso','Sign in with code':'Entrar con el código',
 'Use the mobile number on your patient file. The clinic must have texting configured.':'Use el número de móvil de su expediente. La clínica debe tener configurado el envío de mensajes de texto.',
 'Enter the six-digit code from your text. If no code arrives, use email sign-in or contact your clinic.':'Ingrese el código de seis dígitos del mensaje. Si no llega, use el acceso por correo electrónico o comuníquese con la clínica.',
}
export const pt=(d:any,text:string)=>d.language==='es'?(es[text]??text):text
export const languageChoice=(language:string,action='/portal/action')=>`<form method="post" action="${action}" class="patient-language"><input type="hidden" name="name" value="language.choose"><label>Language / Idioma<select name="language"><option value="en"${language!=='es'?' selected':''}>English</option><option value="es"${language==='es'?' selected':''}>Español</option></select></label><button type="submit">Save language / Guardar idioma</button></form>`
export const publicLanguageChoice=(language:string)=>`<nav aria-label="Language / Idioma"><a href="/portal?lang=en" lang="en">English</a> · <a href="/portal?lang=es" lang="es">Español</a></nav>`
