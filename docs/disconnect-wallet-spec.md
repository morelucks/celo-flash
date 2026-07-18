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
12. GameState is updated to set the userAddress back to null on disconnect.
13. Clicking buttons in the confirmation modal plays the default 'click' sound if enabled.
14. Modals use the app's predefined dark theme overlay and visual aesthetics.
15. Developer state setter window.setUserAddress is exposed for testing connection states.
16. Automation tests verify that the modal opens and closes correctly on both screens.
17. In-app browsers that block popups are handled gracefully via standard redirects.
18. Future revisions can include passkey-based social accounts and quick-reconnect.
19. The application operates primarily on Celo Mainnet (Chain ID 42220).
20. Public forno RPC URL is used as the default provider for network requests.
21. Layout elements adhere to mobile safe-area insets at the bottom.
22. Audio library click sound triggers are managed via the centralized audio utility.
23. Active tab state is managed globally by GameStateContext.
24. Allowed origins are configured in the Privy Developer Console.
25. Port 5173 is the default local development server port.
26. Privy React Auth version 3.35.1 is active in dependencies.
27. Code formatting conforms to the repository's oxlint rules.
