import type { Request, Response } from "express";
import { supabase } from '../client/supabase';
import {v4} from 'uuid';

export const messagePostController = async (req:Request, res:Response):Promise<any>=>{
    
    try{
        const id = v4();
        const {content, channel_id, sender_id, reply_to, is_dm } = req.body;
        const is_dm_bool = (is_dm === 'true'); //else false
        if(!channel_id){
            return res.status(400).json({'error':'No channelId received.'});
        } 
        if(!sender_id){
            return res.status(400).json({'error':'No senderId received.'});
        }

        let media_url:string | null = null;

    
        if (req.file){
            const fileExt = req.file.originalname.split('.').pop();//gets the extension of the file
            const fileName = `${id}.${fileExt}`;//filename to store as , should not conflict.

            const {data, error: uploadError}= await supabase.storage
                .from('attachments')
                .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true,
            });

            if(uploadError){
                console.error(uploadError);
                return res.status(500).json({'error':'Server error'});
            }

            // Get public URL
            const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(fileName);
            media_url = publicUrlData.publicUrl;
            console.log(media_url);
        }
        
        if(!is_dm_bool){ //for server channels
        //store all data in "Message" table 
            const { error: insertError } = await supabase.from('messages').insert({
                id,
                content,
                media_url,
                is_edited: false,
                channel_id,
                sender_id,
                reply_to: reply_to || null,
            });

            if (insertError) {
                console.error(insertError);
                return res.status(500).json({error:'Server error'});
            }
        }
        else{
            //its a dm
            const { error: insertError } = await supabase.from('dm_messages').insert({
                id,
                content,
                media_url,
                is_edited: false,
                thread_id : channel_id,
                sender_id,
                reply_to: reply_to || null,
            });

            if (insertError) {
                console.error(insertError);
                return res.status(500).json({error:'Server error'});
            }
        }
        return res.status(200).json({msg:'Message saved successfully'});
    }
    catch(error:any){
        console.error(error);
        return res.status(500).json({error:'Server error'});
    }
};

/* note : for every get message request , we send 15 messages. */
/* if the offset received is 0 , we send latest 15 messgages. 
    if the offset is 1 , then we send the next 15 messages and so on */
export const messageGetController = async (req:Request, res:Response):Promise<any>=>{
    try{
        const channel_id:string = req.query.channel_id as string;
        const offset:number = parseInt(req.query.offset as string) || 0;
        /* if no offset is received , then we assume 0 as offset*/
        const is_dm:boolean = (req.query.is_dm === 'true');
        
        if(!channel_id){
            return res.status(400).json({msg:'No channelId received'});
        }
        if(offset < 0){
            return res.status(400).json({msg:'offset cannot be negative'});
        }

        const from = offset * 15;
        const to = from + 14;

        //get appropriate table and column name for the channel/thread.
        const table:string = (is_dm)?'dm_messages':'messages';
        const channel:string = (is_dm)?'thread_id':'channel_id';

        /* fetch data*/
        const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq(channel, channel_id)
        .order('timestamp', { ascending: false }) //latest messages
        .range( from, to ); //send 15 messages

        if(error){
            console.error('Error fetching messages:', error);
            return res.status(500).json({msg:'Server Error'});
        }else{
            console.log('Fetched messages:', data);
            return res.status(200).json({data});
        }
    }
    catch(e:any){
        console.log(`Error in GET message : ${e}`);
        return res.status(500).json({'msg':'Server Error'});
    }
}