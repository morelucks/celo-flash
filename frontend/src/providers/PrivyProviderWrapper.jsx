import React, { createContext, useContext } from 'react';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';

/**
 * Celo Mainnet chain definition for Privy.
 */
const celoMainnet = {
  id: 42220,
  name: 'Celo',
  network: 'celo',
  nativeCurrency: {
    decimals: 18,
    name: 'CELO',
    symbol: 'CELO',
  },
  rpcUrls: {
    default: { http: ['https://forno.celo.org'] },
    public: { http: ['https://forno.celo.org'] },
  },
  blockExplorers: {
    default: { name: 'CeloScan', url: 'https://celoscan.io' },
  },
};

/**
 * Privy App ID — replace with your own from https://dashboard.privy.io
 */
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || '';
const isPrivyConfigured = !!PRIVY_APP_ID && PRIVY_APP_ID !== 'REPLACE_WITH_YOUR_PRIVY_APP_ID' && PRIVY_APP_ID !== 'your_privy_app_id_here';

/**
 * Unified context so useWallet can safely access Privy state
 * regardless of whether Privy is configured.
 */
const PrivyStateContext = createContext({
  isAvailable: false,
  login: () => { console.warn('Privy is not configured. Set VITE_PRIVY_APP_ID in your .env file.'); },
  logout: async () => {},
  authenticated: false,
  user: null,
  ready: true,
  wallets: [],
});

export const usePrivyState = () => useContext(PrivyStateContext);

/**
 * Bridge component that reads real Privy hooks and passes them
 * through our own context. Only rendered inside a real PrivyProvider.
 */
function PrivyBridge({ children }) {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();

  return (
    <PrivyStateContext.Provider value={{
      isAvailable: true,
      login,
      logout,
      authenticated,
      user,
      ready,
      wallets,
    }}>
      {children}
    </PrivyStateContext.Provider>
  );
}

/**
 * Wrapper that conditionally renders PrivyProvider.
 * If Privy is not configured (no app ID), the app still works
 * using MiniPay / injected wallet fallback only.
 */
export default function PrivyProviderWrapper({ children }) {
  if (!isPrivyConfigured) {
    // No Privy — app works with MiniPay / MetaMask injected only
    return (
      <PrivyStateContext.Provider value={{
        isAvailable: false,
        login: () => {
          alert('Wallet connect is not configured. Please use MiniPay or install MetaMask.');
        },
        logout: async () => {},
        authenticated: false,
        user: null,
        ready: true,
        wallets: [],
      }}>
        {children}
      </PrivyStateContext.Provider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['google', 'email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#FCFF52',
          logo: '/logos/logo_celo_flash.png',
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        defaultChain: celoMainnet,
        supportedChains: [celoMainnet],
      }}
    >
      <PrivyBridge>
        {children}
      </PrivyBridge>
    </PrivyProvider>
  );
}
