// hooks/useBadgeCache.ts
import { fetchArcanaVotes } from '../lib/api';

import { 
  getBadgeFromCache, 
  setBadgeInCache, 
  invalidateBadgeCache,
  blobToLocalUrl
} from '../utils/badgeCache'; // Ensure the relative path to badgeCache.ts is correct
import { useEffect, useState, useCallback } from 'react';

// --- 1. Assumed Badge Type (Must match your actual API data structure) ---
interface IBadge {
  id: string; 
  name: string;
  imageUrl: string; // The external URL of the image to be cached
  // Add other relevant metadata fields here
}

interface CachedBadgeResult {
  id: string;
  name: string;
  localImageUrl: string; // The local Object URL (Blob URL) for the <img> tag
  isLoading: boolean;
  isCacheHit: boolean; // Indicates if the badge was loaded from the cache
  refreshBadge: () => void; // Function to force-invalidate and refetch the cache
}
// 
type BadgeCacheData = Omit<CachedBadgeResult, 'isLoading' | 'refreshBadge'>;

// ...

// 📌 2. Mock API Function (The placeholder that MUST be replaced) 📌
// This function must contain the actual logic to fetch a single Badge's metadata from the server.
const fetchSingleBadgeFromApi = async (badgeId: string): Promise<IBadge> => {
  // --------------------------------------------------------------------------
  // ⚠️ WARNING: THIS IS MOCK DATA. PLEASE REPLACE THIS WITH YOUR REAL API CALL.
  // Use an existing API utility (e.g., 'request' from '../lib/api') here.
  // --------------------------------------------------------------------------
  
  console.log(`[MOCK API] Simulating fetch for badge ${badgeId} from server...`);
  // Simulate network latency
  await new Promise(res => setTimeout(res, 800)); 

  // Return the required structure
  return {
      id: badgeId,
      name: `Arcana Reward ${badgeId}`,
      // Using a placeholder image URL for testing purposes.
      imageUrl: `https://picsum.photos/id/${(parseInt(badgeId) % 100) + 10}/200/200`, 
  };
  
  // --------------------------------------------------------------------------
};

/**
* A custom React hook for fetching and caching badge images using IndexedDB.
* It manages the loading state, cache hits, and provides a local URL for the image.
* * @param badgeId The unique identifier of the badge to fetch.
* @returns {CachedBadgeResult} An object containing badge data, status, and a refresh function.
*/
export const useBadgeCache = (badgeId: string): CachedBadgeResult => {
  const [data, setData] = useState<BadgeCacheData>({
      id: badgeId,
      name: '',
      localImageUrl: '',
      isCacheHit: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [shouldRefresh, setShouldRefresh] = useState(false);

  // Function for force-refreshing the cache (can be called from the UI)
  const refreshBadge = useCallback(() => {
      setShouldRefresh(true);
  }, []);

  useEffect(() => {
      if (!badgeId) return;

      // This variable holds the local Object URL for cleanup in the cleanup function.
      let currentLocalUrl = '';

      const loadBadge = async () => {
          setIsLoading(true);

          // 1. Handle forced invalidation by the user
          if (shouldRefresh) {
              console.log(`[Cache Control] Forcing refresh for badge ${badgeId}.`);
              await invalidateBadgeCache(badgeId);
              setShouldRefresh(false); 
          }

          try {
              // 2. Attempt to load the badge from IndexedDB cache
              const cachedEntry = await getBadgeFromCache(badgeId);
              
              if (cachedEntry) {
                  // Cache HIT: Entry found and is valid (not expired)
                  const localUrl = blobToLocalUrl(cachedEntry.imageBlob);
                  currentLocalUrl = localUrl;
                  setData({
                      id: badgeId,
                      name: cachedEntry.name,
                      localImageUrl: localUrl,
                      isCacheHit: true, 
                  });
                  
              } else {
                  // Cache MISS / Expired: Fetch data from the external API
                  
                  const badgeApiData = await fetchSingleBadgeFromApi(badgeId);
                  
                  // 3. Cache the new data (including fetching the image Blob)
                  await setBadgeInCache(badgeApiData);
                  
                  // 4. Retrieve the fresh local URL from the newly stored Blob
                  const newCachedEntry = await getBadgeFromCache(badgeId); 
                  
                  if (newCachedEntry) {
                      const localUrl = blobToLocalUrl(newCachedEntry.imageBlob);
                      currentLocalUrl = localUrl;
                      setData({
                          id: badgeId,
                          name: newCachedEntry.name,
                          localImageUrl: localUrl,
                          isCacheHit: false, // Indicates data was loaded from the network
                      });
                  }
              }
          } catch (error) {
              console.error(`Failed to load or cache badge ${badgeId}:`, error);
              // On failure, keep the URL empty so no broken image is displayed
              // خطا در بلوک catch
              setData((prev: BadgeCacheData) => ({ ...prev, localImageUrl: '', isCacheHit: false }));
          } finally {
              setIsLoading(false);
          }
      };

      loadBadge();
      
      // Cleanup function: CRITICAL for memory management! The temporary Blob URL must be revoked
      // when the component unmounts or the badgeId changes.
      return () => {
          if (currentLocalUrl) {
              URL.revokeObjectURL(currentLocalUrl);
          }
      }

  }, [badgeId, shouldRefresh]);

  // Cleanup for old localImageUrl when badgeId changes (cleanup for the previous render cycle)
  useEffect(() => {
      return () => {
           // Revoke the URL from the previous data state when ID changes
          if(data.localImageUrl) URL.revokeObjectURL(data.localImageUrl);
      }
  }, [badgeId]);

  return {
      ...data,
      isLoading,
      refreshBadge,
  };
};