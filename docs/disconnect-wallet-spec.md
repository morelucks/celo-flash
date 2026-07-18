# Web3 Wallet Disconnection Specification
This document describes the design, flow, and user experience for disconnecting Web3 wallets.
1. Privy SDK is configured to handle social (Google/email) and external wallet connections.
2. Inside Opera MiniPay, the injected provider auto-connects without triggering Privy login.
3. Outside MiniPay, Privy handles authentication asynchronously using the PrivyProviderWrapper.
4. Disconnect functions are unified in the useWallet hook, wrapping Privy's logout.
5. Users must confirm they want to disconnect to prevent accidental loss of active sessions.
6. The Header displays the connected wallet address and a close (✕) button.
7. Clicking the close button opens a custom, sleek confirmation modal.
8. The cancel button inside the confirmation modal keeps the wallet connected.
9. The disconnect button executes the wallet disconnect flow and clears address state.
10. When a wallet is connected, the Me screen shows a red 'Disconnect Wallet' action button.
11. Clicking the Disconnect Wallet button on the Me screen triggers the same confirmation modal.
