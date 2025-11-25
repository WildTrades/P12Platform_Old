import { useMemo } from 'react';
import { Abi, WalletClient } from 'viem';
import { getContract } from '../utils/getContract';
import { babtABI, collabABI } from '../abis';
import { Address, useContractRead, useNetwork, usePublicClient, useWalletClient } from 'wagmi';
import { BABT_ADDRESSES, COLLAB_ADDRESS } from '../constants/addresses';
import { CHAIN_ID } from '../constants/enum';

// Retry logic helper function
const executeWithRetry = async (
  fn: () => Promise<any>,
  retries: number = 3,
  delay: number = 1000
): Promise<any> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) {
        console.error('Failed after retries:', error);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
  throw new Error('Max retries reached');
};

export function useContract<TAbi extends Abi>(address?: Address, abi?: TAbi, chainId?: number) {
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient();

  return useMemo(() => {
    if (!address || !abi) return null;
    try {
      return getContract({
        abi,
        address,
        publicClient: publicClient,
        walletClient: walletClient as WalletClient,
      });
    } catch (error) {
      console.error('Failed to get contract', error);
      return null;
    }
  }, [abi, address, publicClient, walletClient]);
}

export function useBABTBalanceOf({ address }: { address?: Address }) {
  const { chain } = useNetwork();
  const babtAddress = chain ? BABT_ADDRESSES[chain.id] : undefined;

  return useContractRead({
    address: babtAddress,
    abi: babtABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    enabled: !!address,
  });
}

export async function fetchMultiChainBABTBalance(address: Address): Promise<{
  bscMainnet: bigint;
  bscTestnet: bigint;
}> {
  const { createPublicClient, http } = await import('viem');
  const { bsc, bscTestnet } = await import('wagmi/chains');

  let bscMainnetBalance = BigInt(0);
  let bscTestnetBalance = BigInt(0);

  try {
    const bscMainnetClient = createPublicClient({
      chain: bsc,
      transport: http(),
    });

    const bscTestnetClient = createPublicClient({
      chain: bscTestnet,
      transport: http(),
    });

    if (BABT_ADDRESSES[CHAIN_ID.BSC_MAINNET]) {
      bscMainnetBalance = await executeWithRetry(async () => {
        const contract = getContract({
          abi: babtABI,
          address: BABT_ADDRESSES[CHAIN_ID.BSC_MAINNET],
          publicClient: bscMainnetClient,
        });
        return contract.read.balanceOf([address]);
      });
    }

    if (BABT_ADDRESSES[CHAIN_ID.BSC_TESTNET]) {
      bscTestnetBalance = await executeWithRetry(async () => {
        const contract = getContract({
          abi: babtABI,
          address: BABT_ADDRESSES[CHAIN_ID.BSC_TESTNET],
          publicClient: bscTestnetClient,
        });
        return contract.read.balanceOf([address]);
      });
    }
  } catch (error) {
    console.error('Error fetching multi-chain balance:', error);
    throw error;
  }

  return {
    bscMainnet: bscMainnetBalance,
    bscTestnet: bscTestnetBalance,
  };
}

export async function fetchCombinedBadgeCount(address: Address): Promise<bigint> {
  try {
    const multiChainBalances = await fetchMultiChainBABTBalance(address);

    return multiChainBalances.bscMainnet + multiChainBalances.bscTestnet;
  } catch (error) {
    console.error('Error fetching combined badge count:', error);
    return BigInt(0);
  }
}

export function useCollabContract() {
  return useContract(COLLAB_ADDRESS, collabABI);
}
