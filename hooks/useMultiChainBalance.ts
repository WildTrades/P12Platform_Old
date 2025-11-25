import { useEffect, useState, useCallback } from 'react';
import { Address, usePublicClient } from 'wagmi';
import { babtABI, badgeABI } from '../abis';
import { BABT_ADDRESSES, BADGE_ADDRESSES } from '../constants/addresses';
import { CHAIN_ID } from '../constants/enum';

type BalanceData = {
  value: bigint;
  formatted: string;
  isLoading: boolean;
  error?: Error;
};

type MultiChainBalances = {
  bscMainnet: BalanceData;
  bscTestnet: BalanceData;
  polygonBscCombined: BalanceData;
  total: BalanceData;
  refetch: () => void;
  isFetching: boolean;
};

const formatBalance = (balance: bigint): string => {
  return balance.toString();
};

class BalanceCache {
  private cache: Map<string, { value: bigint; timestamp: number }> = new Map();
  private readonly ttl = 30000; // 30 seconds TTL

  get(key: string): bigint | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > this.ttl) {
      this.cache.delete(key); // Clean up expired entry
      return null;
    }

    return cached.value;
  }

  set(key: string, value: bigint): void {
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new BalanceCache();

export function useMultiChainBalance(address?: Address): MultiChainBalances {
  const [bscMainnet, setBscMainnet] = useState<BalanceData>({
    value: BigInt(0),
    formatted: '0',
    isLoading: false
  });

  const [bscTestnet, setBscTestnet] = useState<BalanceData>({
    value: BigInt(0),
    formatted: '0',
    isLoading: false
  });

  const [polygonBadge, setPolygonBadge] = useState<BalanceData>({
    value: BigInt(0),
    formatted: '0',
    isLoading: false
  });

  const [isFetching, setIsFetching] = useState<boolean>(false);

  const bscMainnetClient = usePublicClient({ chainId: CHAIN_ID.BSC_MAINNET });
  const bscTestnetClient = usePublicClient({ chainId: CHAIN_ID.BSC_TESTNET });
  const polygonClient = usePublicClient({ chainId: CHAIN_ID.POLYGON });

  const executeWithRetry = useCallback(async (
    fn: () => Promise<bigint>,
    retries: number = 3,
    initialDelay: number = 1000
  ): Promise<bigint> => {
    for (let i = 0; i < retries; i++) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        if (i === retries - 1) {
          console.error('Failed after retries:', error);
          throw error;
        }
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Retry attempt ${i + 1}/${retries} after ${delay}ms`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries reached');
  }, []);

  const fetchContractBalance = useCallback(async (
    client: any,
    contractAddress: Address,
    account: Address,
    abi: any,
    contractType: 'babt' | 'badge' = 'babt'
  ): Promise<bigint> => {
    if (!client || !contractAddress || !account) {
      return BigInt(0);
    }

    const cacheKey = `${contractType}_${contractAddress}_${account}_${client.chain.id}`;

    const cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const result = await executeWithRetry(async () => {
      if (!client) {
        throw new Error('Public client not available');
      }

      const { getContract } = await import('../utils/getContract');
      const contractInstance = getContract({
        abi,
        address: contractAddress,
        publicClient: client,
      });

      if (!contractInstance) {
        throw new Error('Could not create contract instance');
      }

      const result = await contractInstance.read.balanceOf([account]);
      const balance = Array.isArray(result) ? result[0] : result;
      return balance as bigint;
    });

    cache.set(cacheKey, result);

    return result;
  }, [executeWithRetry]);

  const refetch = useCallback(async () => {
    if (!address) return;

    setIsFetching(true);

    setBscMainnet(prev => ({ ...prev, isLoading: true, error: undefined }));
    setBscTestnet(prev => ({ ...prev, isLoading: true, error: undefined }));
    setPolygonBadge(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      const fetchPromises = [];

      fetchPromises.push(fetchContractBalance(
        bscMainnetClient,
        BABT_ADDRESSES[CHAIN_ID.BSC_MAINNET],
        address,
        babtABI,
        'babt'
      ).then(value => ({
        value,
        formatted: formatBalance(value),
        isLoading: false,
        error: undefined
      })).catch(error => ({
        value: BigInt(0),
        formatted: '0',
        isLoading: false,
        error: error as Error,
      })));

      fetchPromises.push(fetchContractBalance(
        bscTestnetClient,
        BABT_ADDRESSES[CHAIN_ID.BSC_TESTNET],
        address,
        babtABI,
        'babt'
      ).then(value => ({
        value,
        formatted: formatBalance(value),
        isLoading: false,
        error: undefined
      })).catch(error => ({
        value: BigInt(0),
        formatted: '0',
        isLoading: false,
        error: error as Error,
      })));

      fetchPromises.push(fetchContractBalance(
        polygonClient,
        BADGE_ADDRESSES[CHAIN_ID.POLYGON],
        address,
        badgeABI,
        'badge'
      ).then(value => ({
        value,
        formatted: formatBalance(value),
        isLoading: false,
        error: undefined
      })).catch(error => ({
        value: BigInt(0),
        formatted: '0',
        isLoading: false,
        error: error as Error,
      })));

      const [mainnetResult, testnetResult, polygonResult] = await Promise.all(fetchPromises);

      setBscMainnet(mainnetResult);
      setBscTestnet(testnetResult);
      setPolygonBadge(polygonResult);
    } catch (error) {
      console.error('Error fetching multi-chain balances:', error);

      setBscMainnet(prev => ({
        ...prev,
        isLoading: false,
        error: error as Error
      }));
      setBscTestnet(prev => ({
        ...prev,
        isLoading: false,
        error: error as Error
      }));
      setPolygonBadge(prev => ({
        ...prev,
        isLoading: false,
        error: error as Error
      }));
    } finally {
      setIsFetching(false);
    }
  }, [
    address,
    bscMainnetClient,
    bscTestnetClient,
    polygonClient,
    fetchContractBalance
  ]);

  const polygonBscCombined: BalanceData = {
    value: bscMainnet.value + polygonBadge.value,
    formatted: (Number(bscMainnet.value) + Number(polygonBadge.value)).toString(),
    isLoading: bscMainnet.isLoading || polygonBadge.isLoading,
    error: bscMainnet.error || polygonBadge.error
  };

  const total: BalanceData = {
    value: bscMainnet.value + bscTestnet.value + polygonBadge.value,
    formatted: (
      Number(bscMainnet.value) +
      Number(bscTestnet.value) +
      Number(polygonBadge.value)
    ).toString(),
    isLoading: bscMainnet.isLoading || bscTestnet.isLoading || polygonBadge.isLoading,
    error: bscMainnet.error || bscTestnet.error || polygonBadge.error
  };

  useEffect(() => {
    if (address) {
      refetch();
    } else {
      setBscMainnet({ value: BigInt(0), formatted: '0', isLoading: false });
      setBscTestnet({ value: BigInt(0), formatted: '0', isLoading: false });
      setPolygonBadge({ value: BigInt(0), formatted: '0', isLoading: false });
    }
  }, [address, refetch]);

  return {
    bscMainnet,
    bscTestnet,
    polygonBscCombined,
    total,
    refetch,
    isFetching,
  };
}