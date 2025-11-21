// Define the necessary structure for a single Badge (as it's missing in your types)
interface IBadge {
  id: string; // The unique identifier, crucial for IndexedDB keyPath
  name: string;
  imageUrl: string; // The URL of the badge image to be cached
  // Add other metadata fields if they exist in your actual server response
}

// Interface for the data stored in IndexedDB
interface ICachedBadgeEntry extends IBadge {
  imageBlob: Blob; // The raw image data (Blob)
  cachedAt: number; // Timestamp of when it was cached
}

// Database configuration
const DB_NAME = 'BadgeCacheDB';
const STORE_NAME = 'badges';
const DB_VERSION = 1;
// Cache duration: 24 hours in milliseconds
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// --- Utility Functions ---

/**
* Converts an external image URL into a Blob object.
* @param url The URL of the image.
* @returns A Promise that resolves with the image Blob.
*/
export const urlToBlob = async (url: string): Promise<Blob> => {
  const response = await fetch(url);
  if (!response.ok) {
      throw new Error(`Failed to fetch image: ${url}`);
  }
  return response.blob();
};

/**
* Converts a Blob object into a local object URL for use in <img> tags.
* This URL must be revoked when the component unmounts to prevent memory leaks.
* @param blob The image Blob.
* @returns The local object URL string.
*/
export const blobToLocalUrl = (blob: Blob): string => {
  return URL.createObjectURL(blob);
};

/**
* Opens the IndexedDB database, handling necessary upgrades.
* @returns A Promise that resolves with the IDBDatabase object.
*/
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          // Create an object store with 'id' as the primary key
          if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
      };

      request.onsuccess = (event) => {
          resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
          console.error('IndexedDB error:', (event.target as IDBOpenDBRequest).error);
          reject((event.target as IDBOpenDBRequest).error);
      };
  });
};

// --- Core Cache Functions ---

/**
* Retrieves a badge entry from the cache if it is valid (not expired).
* @param id The ID of the badge.
* @returns A Promise that resolves with the cached entry or null if not found or expired.
*/
export const getBadgeFromCache = async (id: string): Promise<ICachedBadgeEntry | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
          const entry: ICachedBadgeEntry | undefined = request.result;

          if (entry) {
              // Check if the cache entry is still valid (within 24 hours)
              const isExpired = Date.now() - entry.cachedAt > CACHE_DURATION_MS;
              
              if (isExpired) {
                  // Entry is expired, invalidate it
                  console.log(`[Cache Miss] Badge ${id} is expired.`);
                  invalidateBadgeCache(id).then(() => resolve(null)); // Delete and return null
              } else {
                  // Cache hit and is valid
                  console.log(`[Cache Hit] Badge ${id} is valid.`);
                  resolve(entry);
              }
          } else {
              // Cache miss (not found)
              resolve(null);
          }
      };

      request.onerror = (event) => {
          console.error('Error retrieving from cache:', (event.target as IDBOpenDBRequest).error);
          reject(null); // Return null on error
      };
  });
};

/**
* Fetches badge image, creates a cache entry, and stores it in IndexedDB.
* @param badgeData The badge metadata (id, name, imageUrl).
*/
export const setBadgeInCache = async (badgeData: IBadge): Promise<void> => {
  try {
      // 1. Fetch the image and get the Blob
      const imageBlob = await urlToBlob(badgeData.imageUrl);
      
      // 2. Create the full cache entry
      const entry: ICachedBadgeEntry = {
          ...badgeData,
          imageBlob: imageBlob,
          cachedAt: Date.now(), // Store current time
      };

      // 3. Store in IndexedDB
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(entry); // Use put for upsert (insert or update)

          request.onsuccess = () => {
              console.log(`[Cache Set] Badge ${badgeData.id} stored successfully.`);
              resolve();
          };

          request.onerror = (event) => {
              console.error('Error storing in cache:', (event.target as IDBOpenDBRequest).error);
              reject((event.target as IDBOpenDBRequest).error);
          };
      });
  } catch (error) {
      console.error(`Failed to set badge ${badgeData.id} in cache:`, error);
      throw error;
  }
};

/**
* Removes a badge entry from the cache (force invalidation).
* @param id The ID of the badge to remove.
*/
export const invalidateBadgeCache = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
          console.log(`[Cache Invalidate] Badge ${id} removed.`);
          resolve();
      };

      request.onerror = (event) => {
          console.error('Error deleting from cache:', (event.target as IDBOpenDBRequest).error);
          reject((event.target as IDBOpenDBRequest).error);
      };
  });
};