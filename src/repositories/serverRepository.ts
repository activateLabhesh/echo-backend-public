import { supabase } from '../client/supabase'


export async function getServerIds(userId: string){

    const { data: memberEntries, error: memberError } = await supabase
          .from('server_members')
          .select('server_id')
          .eq('user_id', userId); 

    if (memberError) {
        throw new Error(`Database error fetching memberships: ${memberError.message}`);
    }

    return memberEntries;

}


export async function serverDetails(serverIds : string[]){

    const { data: servers, error: serverError } = await supabase
        .from('servers')
        .select('name, icon_url, id')
        .in('id', serverIds);

    if (serverError) {
        throw new Error(`Database error fetching servers: ${serverError.message}`);
    }

      return servers;

}