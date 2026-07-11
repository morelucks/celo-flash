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
