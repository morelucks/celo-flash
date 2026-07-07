import { useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';

export const useWallet = () => {
  const { setUserAddress, setUserName, userAddress } = useGameState();

  useEffect(() => {
    const connectWallet = async () => {
      if (typeof window.ethereum !== 'undefined') {
        try {
          // Check if already connected
          const accounts = await window.ethereum.request({ 
            method: 'eth_accounts' 
          });
          
          if (accounts.length > 0) {
            setUserAddress(accounts[0]);
          }

          // Listen for account changes
          window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length > 0) {
              setUserAddress(accounts[0]);
            } else {
              setUserAddress(null);
              setUserName('Guest');
            }
          });
        } catch (error) {
          console.error('Error connecting wallet:', error);
        }
      }
    };

    connectWallet();

    // Cleanup
    return () => {
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', () => {});
      }
    };
  }, [setUserAddress, setUserName]);

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        });
        setUserAddress(accounts[0]);
        return accounts[0];
      } catch (error) {
        console.error('Error connecting wallet:', error);
        return null;
      }
    } else {
      alert('Please install MetaMask or use MiniPay to connect your wallet');
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
