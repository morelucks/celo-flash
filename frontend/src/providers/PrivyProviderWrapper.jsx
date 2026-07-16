import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';

/**
 * Celo Mainnet chain definition for Privy.
 * Privy needs an explicit chain object with id, name, rpcUrls, etc.
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
 * For testing, Privy provides a demo app ID.
 */
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'REPLACE_WITH_YOUR_PRIVY_APP_ID';

export default function PrivyProviderWrapper({ children }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Login methods: social (Google) + wallets (MetaMask, WalletConnect, etc.)
        loginMethods: ['google', 'email', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#FCFF52', // Celo yellow-green brand accent
          logo: '/logos/logo_celo_flash.png',
          showWalletLoginFirst: false,
        },
        // Embedded wallet config — creates wallets for social-login users
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        // Default to Celo chain
        defaultChain: celoMainnet,
        supportedChains: [celoMainnet],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
