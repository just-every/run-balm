import { actor, guard, human, insist, one, practitionerId, text, type Actor } from '../domain/model'
import { clientVisible } from '../domain/clients'
import { clientAuthority } from '../messages/access'

export async function outcomeClinician(db:D1Database,who:Actor,clientId:unknown){
 human(who)
 const live={...await actor(db,who.id),sessionId:who.sessionId}
 insist(live.role==='owner'||practitionerId(live),'outcomes_require_clinical_access',403)
 insist(!['assistant','student','fellow'].includes(live.staffKind??''),'outcomes_require_treating_therapist',403)
 return {who:live,client:await clientVisible(db,live,clientId)}
}
export async function outcomeEpisode(db:D1Database,who:Actor,episodeId:unknown){
 const episode=await one(db,'SELECT * FROM bm_episodes WHERE id=?',text(episodeId,'episode',100))
 insist(episode,'episode_not_found',404)
 return {...await outcomeClinician(db,who,episode.client_id),episode}
}
export const outcomeAuthority=(db:D1Database,who:Actor,clientId:string,episodeId:string)=>[
 clientAuthority(db,who,clientId),guard(db,'EXISTS(SELECT 1 FROM bm_episodes WHERE id=? AND client_id=? AND closed_at IS NULL)',episodeId,clientId)
]
