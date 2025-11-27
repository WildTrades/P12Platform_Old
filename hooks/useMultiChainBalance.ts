import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Address } from 'wagmi';
import { bsc, bscTestnet, polygon } from 'wagmi/chains';

import { babtABI, badgeABI } from '@/abis';
import { BABT_ADDRESSES } from '@/constants/addresses';
import { BADGE_CONTRACT_ADDRESS, CHAIN_ID, GalxeBadge } from '@/constants';
import { useBadgeNFT } from './bridge';
import { useChainPublicClient } from './useContract';

type BalanceValue = bigint | null;

type BalanceState = {
  babtBalances: {
    bscMainnet: BalanceValue;
    bscTestnet: BalanceValue;
  };
  badgeBalances: {
    polygon: BalanceValue;
    bsc: BalanceValue;
  };
};

type BadgeCounts = {
  polygon: number;
  bsc: number;
  total: number;
};

type BadgeContractMap = Record<number, Address[]>;

type MultiChainBalanceQueryData = {
  balances: BalanceState;
  errors: Record<string, Error | null>;
};

const QUERY_STALE_TIME = 300_000; // 5 minutes
const QUERY_CACHE_TIME = 600_000; // 10 minutes
const RETRY_DELAYS = [1000, 2000, 4000];

const DEFAULT_BALANCES: BalanceState = {
  babtBalances: {
    bscMainnet: null,
    bscTestnet: null,
  },
  badgeBalances: {
    polygon: null,
    bsc: null,
  },
};

const DEFAULT_ERROR_KEYS = ['babt:bscMainnet', 'babt:bscTestnet', 'badge:polygon', 'badge:bsc', 'badge:graphQL'] as const;

const DEFAULT_ERRORS = DEFAULT_ERROR_KEYS.reduce<Record<string, Error | null>>((acc, key) => {
  acc[key] = null;
  return acc;
}, {});

const normalizeError = (error: unknown) => {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
};

const extractBadges = (data: unknown): GalxeBadge[] => {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data as GalxeBadge[];
  }

  const user = (data as { user?: { galxeBadges?: GalxeBadge[] } })?.user;

  return user?.galxeBadges ?? [];
};

const createBadgeInsights = (badges: GalxeBadge[]): { counts: BadgeCounts; contracts: BadgeContractMap } => {
  const polygonContracts = new Set<Address>();
  const bscContracts = new Set<Address>();
  let polygonCount = 0;
  let bscCount = 0;

  badges.forEach((badge) => {
    const chainId = Number(badge.chainId);
    const contract = badge.contractAddress as Address | undefined;

    if (chainId === polygon.id) {
      polygonCount += 1;
      if (contract) polygonContracts.add(contract);
    } else if (chainId === CHAIN_ID.BSC_MAINNET) {
      bscCount += 1;
      if (contract) bscContracts.add(contract);
    }
  });

  const ensureSortedArray = (set: Set<Address>) => Array.from(set).sort((a, b) => a.localeCompare(b));

  const contracts: BadgeContractMap = {
    [polygon.id]: ensureSortedArray(polygonContracts),
    [CHAIN_ID.BSC_MAINNET]: ensureSortedArray(bscContracts),
  };

  if (!contracts[polygon.id].length) {
    contracts[polygon.id] = [BADGE_CONTRACT_ADDRESS as Address];
  }

  return {
    counts: {
      polygon: polygonCount,
      bsc: bscCount,
      total: polygonCount + bscCount,
    },
    contracts,
  };
};

const buildContractsKey = (contracts: BadgeContractMap) => {
  const polygonContracts = contracts[polygon.id] ?? [];
  const bscContracts = contracts[CHAIN_ID.BSC_MAINNET] ?? [];

  return JSON.stringify({
    polygon: polygonContracts,
    bsc: bscContracts,
  });
};

async function readBalance({
  client,
  contractAddress,
  owner,
}: {
  client: ReturnType<typeof useChainPublicClient>;
  contractAddress?: Address;
  owner?: Address;
}) {
  if (!client || !contractAddress || !owner) {
    throw new Error('Missing client, contract address, or owner for balance read');
  }

  return client.readContract({
    address: contractAddress,
    abi: babtABI,
    functionName: 'balanceOf',
    args: [owner],
  }) as Promise<bigint>;
}

async function readBadgeBalances({
  client,
  contracts,
  owner,
}: {
  client: ReturnType<typeof useChainPublicClient>;
  contracts?: Address[];
  owner?: Address;
}) {
  if (!client || !owner || !contracts || !contracts.length) {
    throw new Error('Missing client, owner, or badge contracts for read');
  }

  const results = await Promise.allSettled(
    contracts.map((contractAddress) =>
      client.readContract({
        address: contractAddress,
        abi: badgeABI,
        functionName: 'balanceOf',
        args: [owner],
      }),
    ),
  );

  let total = BigInt(0);
  let hasSuccess = false;
  let firstError: Error | null = null;

  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      hasSuccess = true;
      total += result.value as bigint;
    } else if (!firstError) {
      firstError = normalizeError(result.reason);
    }
  });

  if (!hasSuccess) {
    throw firstError ?? new Error('Failed to read badge balances');
  }

  return total;
}

export function useMultiChainBalance(address?: Address) {
  const bscMainnetClient = useChainPublicClient(bsc.id);
  const bscTestnetClient = useChainPublicClient(bscTestnet.id);
  const polygonClient = useChainPublicClient(polygon.id);

  const {
    data: badgeDataRaw,
    isLoading: isBadgeLoading,
    error: badgeError,
  } = useBadgeNFT(address);

  const badgeInsights = useMemo(() => createBadgeInsights(extractBadges(badgeDataRaw)), [badgeDataRaw]);

  const badgeContractsKey = useMemo(() => buildContractsKey(badgeInsights.contracts), [badgeInsights.contracts]);

  const multiChainQuery = useQuery<MultiChainBalanceQueryData>({
    queryKey: ['multi-chain-balance', address, badgeContractsKey],
    enabled: !!address,
    staleTime: QUERY_STALE_TIME,
    cacheTime: QUERY_CACHE_TIME,
    retry: 3,
    retryDelay: (attempt) => RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)],
    queryFn: async () => {
      if (!address) {
        return { balances: DEFAULT_BALANCES, errors: DEFAULT_ERRORS };
      }

      const result: BalanceState = {
        babtBalances: { ...DEFAULT_BALANCES.babtBalances },
        badgeBalances: { ...DEFAULT_BALANCES.badgeBalances },
      };

      const errors: Record<string, Error | null> = { ...DEFAULT_ERRORS };

      const tasks: Array<{
        key: typeof DEFAULT_ERROR_KEYS[number];
        runner: () => Promise<bigint | null>;
        assign: (value: bigint | null) => void;
      }> = [
        {
          key: 'babt:bscMainnet',
          runner: () =>
            readBalance({
              client: bscMainnetClient,
              contractAddress: BABT_ADDRESSES[CHAIN_ID.BSC_MAINNET],
              owner: address,
            }),
          assign: (value) => {
            result.babtBalances.bscMainnet = value;
          },
        },
        {
          key: 'babt:bscTestnet',
          runner: () =>
            readBalance({
              client: bscTestnetClient,
              contractAddress: BABT_ADDRESSES[CHAIN_ID.BSC_TESTNET],
              owner: address,
            }),
          assign: (value) => {
            result.babtBalances.bscTestnet = value;
          },
        },
        {
          key: 'badge:polygon',
          runner: () =>
            readBadgeBalances({
              client: polygonClient,
              contracts: badgeInsights.contracts[polygon.id],
              owner: address,
            }),
          assign: (value) => {
            result.badgeBalances.polygon = value;
          },
        },
        {
          key: 'badge:bsc',
          runner: () =>
            readBadgeBalances({
              client: bscMainnetClient,
              contracts: badgeInsights.contracts[CHAIN_ID.BSC_MAINNET],
              owner: address,
            }),
          assign: (value) => {
            result.badgeBalances.bsc = value;
          },
        },
      ];

      const settled = await Promise.allSettled(tasks.map((task) => task.runner()));

      settled.forEach((state, index) => {
        const task = tasks[index];
        if (state.status === 'fulfilled') {
          task.assign(state.value);
        } else {
          errors[task.key] = normalizeError(state.reason);
        }
      });

      return { balances: result, errors };
    },
  });

  const combinedErrors = useMemo(() => {
    return {
      ...DEFAULT_ERRORS,
      ...multiChainQuery.data?.errors,
      'badge:graphQL': badgeError ? normalizeError(badgeError) : null,
    };
  }, [badgeError, multiChainQuery.data?.errors]);

  return {
    babtBalances: multiChainQuery.data?.balances.babtBalances ?? DEFAULT_BALANCES.babtBalances,
    badgeBalances: multiChainQuery.data?.balances.badgeBalances ?? DEFAULT_BALANCES.badgeBalances,
    badgeCounts: badgeInsights.counts as BadgeCounts,
    errors: combinedErrors,
    isLoading: multiChainQuery.isLoading || isBadgeLoading,
    isFetching: multiChainQuery.isFetching || isBadgeLoading,
    refetch: multiChainQuery.refetch,
  };
}

