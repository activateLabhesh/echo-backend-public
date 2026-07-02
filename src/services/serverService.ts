import * as serverRepository from '../repositories/serverRepository';
import { getCacheRedisClient } from '../redis/cacheClient';


export async function fetchServer(userId: string){
  try {
      if (!userId) {
        throw new Error("User id not provided.");
      }

      const redis = getCacheRedisClient();

      if(redis.status==="wait"){
        await redis.connect();
      }

      const cacheKey = `user:${userId}:servers`;

      const cachedServers = await redis.get(cacheKey);

        if (cachedServers) {
            return JSON.parse(cachedServers);
        } else {
            const memberEntries = await serverRepository.getServerIds(userId);

            if (!memberEntries || memberEntries.length === 0) {
                return [];
            }

            const serverIds = memberEntries.map(entry => entry.server_id);
            const servers = await serverRepository.serverDetails(serverIds);

            await redis.set(cacheKey, JSON.stringify(servers), 'EX', 1800);
            return servers;
        }

  } catch (error) {
      const err = error as Error;
      throw new Error(`Error fetching servers: ${err}`);
  }

}