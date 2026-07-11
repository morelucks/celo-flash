/**
 * MiniPay integration utilities
 */

/**
 * Check if the application is running inside the Opera MiniPay mobile wallet.
 * @returns {boolean}
 */
export function isMiniPay() {
  return typeof window !== "undefined" &&
    window.ethereum !== undefined &&
    window.ethereum.isMiniPay === true;
}

/**
 * Redirect the user to the native MiniPay Add Cash/Deposit interface.
 */
export function redirectToDeposit() {
  if (typeof window !== "undefined") {
    window.location.href = "https://link.minipay.xyz/add_cash?tokens=USDm,USDC,USDT";
  }
}


// docs: define requirements for MiniPay auto-connection and Celo network switching


// refactor: extend isMiniPay utility function to support window.celo


// style: create wallet-status-badge classes in index.css


// refactor: retrieve userAddress from game state in Header component


// style: implement conditional green and red indicators in Header


// refactor: introduce Celo Mainnet parameter constants in useWallet hook


// refactor: write switchNetwork utility to handle chain switching on Celo


// refactor: implement auto-connection flow inside useWallet hook


// refactor: configure event listeners for accountsChanged on Celo


// refactor: configure event listeners for chainChanged to trigger auto-switch
