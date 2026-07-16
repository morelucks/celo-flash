import { useEffect, useCallback } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useGameState } from '../context/GameStateContext';
import { isMiniPay } from '../utils/minipay';

/**
 * Unified wallet hook that supports:
 * 1. MiniPay (injected provider, auto-connects inside MiniPay app)
 * 2. Privy (social login via Google/email + external wallets via WalletConnect)
 *
 * Priority: MiniPay detection first → then Privy
 */
export const useWallet = () => {
  const { setUserAddress, setUserName, userAddress } = useGameState();
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();

  // ─── MiniPay: auto-connect via injected provider ───────────────────
  const switchNetwork = useCallback(async (ethProvider) => {
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
  }, []);

  // Auto-connect MiniPay on mount (highest priority — runs inside MiniPay app)
  useEffect(() => {
    if (!isMiniPay()) return;

    const autoConnectMiniPay = async () => {
      const ethProvider = window.ethereum || window.celo;
      if (!ethProvider) return;

      try {
        // Auto-request accounts (MiniPay approves silently)
        const accounts = await ethProvider.request({
          method: 'eth_requestAccounts',
        });

        if (accounts.length > 0) {
          setUserAddress(accounts[0]);

          // Ensure Celo Mainnet
          const chainId = await ethProvider.request({ method: 'eth_chainId' });
          if (chainId !== '0xa4ec' && chainId !== '42220') {
            await switchNetwork(ethProvider);
          }
        }

        // Listen for account changes
        if (ethProvider.on) {
          ethProvider.on('accountsChanged', (accts) => {
            if (accts.length > 0) {
              setUserAddress(accts[0]);
            } else {
              setUserAddress(null);
              setUserName('Guest');
            }
          });

          ethProvider.on('chainChanged', async (newChainId) => {
            if (newChainId !== '0xa4ec' && newChainId !== '42220') {
              await switchNetwork(ethProvider);
            }
          });
        }
      } catch (error) {
        console.error('MiniPay auto-connect error:', error);
      }
    };

    autoConnectMiniPay();

    return () => {
      const ethProvider = window.ethereum || window.celo;
      if (ethProvider && ethProvider.removeListener) {
        ethProvider.removeListener('accountsChanged', () => {});
        ethProvider.removeListener('chainChanged', () => {});
      }
    };
  }, [setUserAddress, setUserName, switchNetwork]);

  // ─── Privy: sync wallet address when user authenticates ────────────
  useEffect(() => {
    // Skip Privy sync if inside MiniPay (MiniPay handles its own connection)
    if (isMiniPay()) return;
    if (!ready) return;

    if (authenticated && wallets.length > 0) {
      // Prefer embedded wallet, fall back to first connected wallet
      const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
      const activeWallet = embeddedWallet || wallets[0];

      if (activeWallet && activeWallet.address) {
        setUserAddress(activeWallet.address);

        // Set a display name from the Privy user profile
        if (user) {
          const googleAccount = user.google;
          const emailAccount = user.email;
          if (googleAccount?.name) {
            setUserName(googleAccount.name);
          } else if (emailAccount?.address) {
            setUserName(emailAccount.address.split('@')[0]);
          }
        }
      }
    } else if (!authenticated && !isMiniPay()) {
      // Only clear if not in MiniPay (MiniPay manages its own state)
      // Don't clear if we have a MiniPay-derived address
      if (userAddress && !isMiniPay()) {
        // User logged out of Privy — keep guest state
      }
    }
  }, [authenticated, wallets, user, ready, setUserAddress, setUserName, userAddress]);

  // ─── Connect: MiniPay direct or Privy login ────────────────────────
  const connectWallet = useCallback(async () => {
    // Inside MiniPay → use injected provider directly
    if (isMiniPay()) {
      const ethProvider = window.ethereum || window.celo;
      if (ethProvider) {
        try {
          const chainId = await ethProvider.request({ method: 'eth_chainId' });
          if (chainId !== '0xa4ec' && chainId !== '42220') {
            await switchNetwork(ethProvider);
          }

          const accounts = await ethProvider.request({
            method: 'eth_requestAccounts',
          });
          setUserAddress(accounts[0]);
          return accounts[0];
        } catch (error) {
          console.error('Error connecting MiniPay wallet:', error);
          return null;
        }
      }
      return null;
    }

    // Outside MiniPay → open Privy login modal (Google / email / wallet)
    try {
      login();
      // Address will be set by the useEffect above when authentication completes
      return null; // Privy handles the flow asynchronously
    } catch (error) {
      console.error('Error opening Privy login:', error);
      return null;
    }
  }, [login, switchNetwork, setUserAddress]);

  // ─── Disconnect ────────────────────────────────────────────────────
  const disconnectWallet = useCallback(async () => {
    if (isMiniPay()) {
      // MiniPay doesn't support disconnect, just clear local state
      setUserAddress(null);
      setUserName('Guest');
      return;
    }

    // Privy logout
    try {
      await logout();
    } catch (e) {
      console.error('Privy logout error:', e);
    }
    setUserAddress(null);
    setUserName('Guest');
  }, [logout, setUserAddress, setUserName]);

  return {
    userAddress,
    connectWallet,
    disconnectWallet,
    isPrivyAuthenticated: authenticated,
    privyUser: user,
    privyReady: ready,
  };
};
