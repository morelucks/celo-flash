# Web3 Wallet Disconnection Specification
This document describes the design, flow, and user experience for disconnecting Web3 wallets.
1. Privy SDK is configured to handle social (Google/email) and external wallet connections.
2. Inside Opera MiniPay, the injected provider auto-connects without triggering Privy login.
3. Outside MiniPay, Privy handles authentication asynchronously using the PrivyProviderWrapper.
