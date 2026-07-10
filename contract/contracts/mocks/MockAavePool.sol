// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";

/**
 * @title MockAavePool
 * @notice Simple mock of Aave V3 Pool for testing supply and withdraw.
 */
contract MockAavePool {
    IERC20 public immutable underlying;
    MockERC20 public immutable aToken;

    constructor(address _underlying, address _aToken) {
        underlying = IERC20(_underlying);
        aToken = MockERC20(_aToken);
    }

    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external {
        require(asset == address(underlying), "Invalid asset");
        underlying.transferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        require(asset == address(underlying), "Invalid asset");
        // Burn aTokens from the caller
        aToken.burn(msg.sender, amount);
        
        // If underlying balance is not enough (simulating yield payout), mint the difference
        uint256 poolBalance = underlying.balanceOf(address(this));
        if (poolBalance < amount) {
            MockERC20(address(underlying)).mint(address(this), amount - poolBalance);
        }
        underlying.transfer(to, amount);
        return amount;
    }
}
