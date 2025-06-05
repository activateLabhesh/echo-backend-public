import dotenv from 'dotenv';
dotenv.config();

import type { Request, Response } from "express";

import {v4} from 'uuid';

import {createClient} from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

export const messagePostController = async (req:Request, res:Response):Promise<any>=>{
    
    const id = v4();
    const {content, channelId, senderId, replyToId } = req.body;
    if(!channelId){
        return res.status(400).json({'error':'No channelId received.'});
    } 
    if(!senderId){
        return res.status(400).json({'error':'No senderId received.'});
    }

    let mediaUrl:string | null = null;

    try{
        if (req.file) {
            const fileExt = req.file.originalname.split('.').pop();//gets the extension of the file
            const fileName = `${id}.${fileExt}`;//filename to store as , should not conflict.

            const {data, error: uploadError}= await supabase.storage
                .from(process.env.SUPABASE_BUCKET!)
                .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true,
            });

            if(uploadError){
                console.error(uploadError);
                return res.status(500).json({'error':'Server error'});
            }

            // Get public URL
            const { data: publicUrlData } = supabase.storage.from(process.env.SUPABASE_BUCKET!).getPublicUrl(fileName);
            mediaUrl = publicUrlData.publicUrl;
        }

        //store all data in "Message" table
        const { error: insertError } = await supabase.from('Message').insert({
            id,
            content,
            mediaUrl,
            isEdited: false,
            channelId,
            senderId,
            replyToId: replyToId || null,
        });

        if (insertError) {
            console.error(insertError);
            return res.status(500).json({error:'Server error'});
        }
        return res.status(200).json({msg:'Message saved successfully'});
    } 
    catch(error:any){
        console.error(error);
        return res.status(500).json({error:'Server error'});
    }
};

