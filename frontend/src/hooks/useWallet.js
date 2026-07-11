import { useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';

export const useWallet = () => {
  const { setUserAddress, setUserName, userAddress } = useGameState();

  const switchNetwork = async (ethProvider) => {
    try {
      await ethProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xa4ec' }], // Celo Mainnet Chain ID 42220
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await ethProvider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0xa4ec',
                chainName: 'Celo Mainnet',
                nativeCurrency: {
                  name: 'CELO',
                  symbol: 'CELO',
                  decimals: 18,
                },
                rpcUrls: ['https://forno.celo.org'],
                blockExplorerUrls: ['https://celoscan.io'],
              },
            ],
          });
        } catch (addError) {
          console.error('Error adding Celo Mainnet chain:', addError);
        }
      } else {
        console.error('Error switching network to Celo Mainnet:', switchError);
      }
    }
  };

  useEffect(() => {
    const connectWalletOnLoad = async () => {
      const ethProvider = window.ethereum || window.celo;
      if (ethProvider) {
        try {
          // Check chainId and switch if needed
          const chainId = await ethProvider.request({ method: 'eth_chainId' });
          if (chainId !== '0xa4ec' && chainId !== '42220') {
            await switchNetwork(ethProvider);
          }

          // Automatically prompt user to connect their wallet
          const accounts = await ethProvider.request({ 
            method: 'eth_requestAccounts' 
          });
          
          if (accounts.length > 0) {
            setUserAddress(accounts[0]);
          }

          // Listen for account changes
          if (ethProvider.on) {
            ethProvider.on('accountsChanged', (accounts) => {
              if (accounts.length > 0) {
                setUserAddress(accounts[0]);
              } else {
                setUserAddress(null);
                setUserName('Guest');
              }
            });

            // Listen for chain changes
            ethProvider.on('chainChanged', async (newChainId) => {
              if (newChainId !== '0xa4ec' && newChainId !== '42220') {
                await switchNetwork(ethProvider);
              }
            });
          }
        } catch (error) {
          console.error('Error auto-connecting wallet:', error);
        }
      }
    };

    connectWalletOnLoad();

    // Cleanup
    return () => {
      const ethProvider = window.ethereum || window.celo;
      if (ethProvider && ethProvider.removeListener) {
        ethProvider.removeListener('accountsChanged', () => {});
        ethProvider.removeListener('chainChanged', () => {});
      }
    };
  }, [setUserAddress, setUserName]);

  const connectWallet = async () => {
    const ethProvider = window.ethereum || window.celo;
    if (ethProvider) {
      try {
        const chainId = await ethProvider.request({ method: 'eth_chainId' });
        if (chainId !== '0xa4ec' && chainId !== '42220') {
          await switchNetwork(ethProvider);
        }

        const accounts = await ethProvider.request({ 
          method: 'eth_requestAccounts' 
        });
        setUserAddress(accounts[0]);
        return accounts[0];
      } catch (error) {
        console.error('Error manual connecting wallet:', error);
        return null;
      }
    } else {
      alert('Please install MetaMask or open inside MiniPay/Opera Mini browser.');
      return null;
    }
  };

  const disconnectWallet = () => {
    setUserAddress(null);
    setUserName('Guest');
  };

  return {
    userAddress,
    connectWallet,
    disconnectWallet
  };
};
