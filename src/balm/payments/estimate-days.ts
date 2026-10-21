import { datePlus } from '../availability/timezone'
const observed=(date:string)=>{const day=new Date(date+'T12:00:00Z').getUTCDay();return day===6?datePlus(date,-1):day===0?datePlus(date,1):date}
function weekday(year:number,month:number,day:number,n:number){const first=`${year}-${String(month).padStart(2,'0')}-01`;return datePlus(first,(day-new Date(first+'T12:00:00Z').getUTCDay()+7)%7+7*(n-1))}
function lastMonday(year:number,month:number){const last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);return datePlus(last,-((new Date(last+'T12:00:00Z').getUTCDay()+6)%7))}
/** Federal business days: clinic closures never extend the federal deadline. */
export function businessDay(date:string){
 const day=new Date(date+'T12:00:00Z').getUTCDay();if(day===0||day===6)return false
 const year=Number(date.slice(0,4)),holidays=new Set<string>()
 for(const y of [year-1,year,year+1]) {
  for(const suffix of ['01-01','06-19','07-04','11-11','12-25'])holidays.add(observed(`${y}-${suffix}`))
  for(const h of [weekday(y,1,1,3),weekday(y,2,1,3),lastMonday(y,5),weekday(y,9,1,1),weekday(y,10,1,2),weekday(y,11,4,4)])holidays.add(h)
 }
 return !holidays.has(date)
}
export function addBusinessDays(date:string,count:number){let result=date;while(count>0){result=datePlus(result,1);if(businessDay(result))count--}return result}
export function businessDistance(from:string,through:string){let n=0;for(let d=datePlus(from,1);d<=through;d=datePlus(d,1))if(businessDay(d))n++;return n}
