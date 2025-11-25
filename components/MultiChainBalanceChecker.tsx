import { useAccount } from 'wagmi';
import { useMultiChainBalance } from '../hooks/useMultiChainBalance';

export default function MultiChainBalanceChecker() {
  const { address, isConnected } = useAccount();
  const {
    bscMainnet,
    bscTestnet,
    polygonBscCombined,
    total,
    refetch,
    isFetching
  } = useMultiChainBalance(address);

  if (!isConnected) {
    return <div>Connect your wallet to check multi-chain balances</div>;
  }

  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-lg font-bold mb-4">Multi-Chain Balance Checker</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="p-3 border rounded">
          <h4 className="font-semibold">BSC Mainnet</h4>
          <p>Balance: {bscMainnet.formatted}</p>
          {bscMainnet.error && <p className="text-red-500">Error: {bscMainnet.error.message}</p>}
          {bscMainnet.isLoading && <p>Loading...</p>}
        </div>
        
        <div className="p-3 border rounded">
          <h4 className="font-semibold">BSC Testnet</h4>
          <p>Balance: {bscTestnet.formatted}</p>
          {bscTestnet.error && <p className="text-red-500">Error: {bscTestnet.error.message}</p>}
          {bscTestnet.isLoading && <p>Loading...</p>}
        </div>
        
        <div className="p-3 border rounded">
          <h4 className="font-semibold">Polygon + BSC Combined</h4>
          <p>Balance: {polygonBscCombined.formatted}</p>
          {polygonBscCombined.isLoading && <p>Loading...</p>}
        </div>
        
        <div className="p-3 border rounded bg-gray-100">
          <h4 className="font-semibold">Total Balance</h4>
          <p>Balance: {total.formatted}</p>
          {total.isLoading && <p>Loading...</p>}
        </div>
      </div>
      
      <div className="flex gap-2">
        <button 
          onClick={() => refetch()} 
          disabled={isFetching}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {isFetching ? 'Fetching...' : 'Refetch Balances'}
        </button>
      </div>
    </div>
  );
}