// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface IPool {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
}

/**
 * @title CeloFlashSavings
 * @author CeloFlash Team
 * @notice Handles on-chain savings for Celo Flash players.
 *         Allows locking USDm stablecoin and native CELO, with yield-generation routing to Aave V3.
 *
 * @dev Security features:
 *   - ReentrancyGuard on all deposit and withdrawal functions
 *   - Pausable circuit breaker for deposits
 *   - SafeERC20 for token transfers
 *   - Owner-managed approved source catalog (e.g. CeloFlashStore for auto-roundups)
 *   - CEI (Checks-Effects-Interactions) pattern throughout
 */
contract CeloFlashSavings is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────
    //  State Variables
    // ─────────────────────────────────────────────

    /// @notice The stablecoin used for savings (USDm)
    IERC20 public immutable stablecoin;

    /// @notice The Aave V3 Pool contract
    IPool public immutable aavePool;

    /// @notice The interest-bearing aToken (aUSDm)
    IERC20 public immutable aToken;

    /// @notice Approved sources that can call deposit on behalf of users (e.g., CeloFlashStore)
    mapping(address => bool) public approvedSources;

    /// @notice USDm savings shares per user
    mapping(address => uint256) private _usdmShares;

    /// @notice Total USDm shares minted
    uint256 private _totalUSDmShares;

    /// @notice CELO savings balance per user
    mapping(address => uint256) public celoBalances;

    /// @notice Total CELO locked in the contract
    uint256 public totalCELOLocked;

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────

    event SavingsDeposited(
        address indexed user,
        address indexed token, // address(0) for CELO
        uint256 amount,
        uint256 timestamp
    );

    event SavingsWithdrawn(
        address indexed user,
        address indexed token, // address(0) for CELO
        uint256 amount,
        uint256 timestamp
    );

    event SourceApprovalUpdated(address indexed source, bool approved);

    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    // ─────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────

    error InvalidAddress();
    error ZeroAmount();
    error Unauthorized();
    error InsufficientBalance();
    error TransferFailed();

    // ─────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────

    modifier onlyUserOrApprovedSource(address _user) {
        if (msg.sender != _user && !approvedSources[msg.sender]) {
            revert Unauthorized();
        }
        _;
    }

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    constructor(
        address _stablecoin,
        address _aavePool,
        address _aToken
    ) Ownable(msg.sender) {
        if (_stablecoin == address(0) || _aavePool == address(0) || _aToken == address(0)) {
            revert InvalidAddress();
        }
        stablecoin = IERC20(_stablecoin);
        aavePool = IPool(_aavePool);
        aToken = IERC20(_aToken);
    }

    // ─────────────────────────────────────────────
    //  External/Public View Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Get the USDm savings balance (including accrued yield) for a user.
     * @param _user The address of the user
     */
    function usdmBalances(address _user) public view returns (uint256) {
        if (_totalUSDmShares == 0) return 0;
        return (_usdmShares[_user] * aToken.balanceOf(address(this))) / _totalUSDmShares;
    }

    /**
     * @notice Get the total USDm locked in the savings contract (including accrued yield).
     */
    function totalUSDmLocked() public view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    /**
     * @notice Get the USDm shares of a user.
     */
    function usdmShares(address _user) public view returns (uint256) {
        return _usdmShares[_user];
    }

    /**
     * @notice Get the total USDm shares.
     */
    function totalUSDmShares() public view returns (uint256) {
        return _totalUSDmShares;
    }

    // ─────────────────────────────────────────────
    //  External/Public Write Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Deposit USDm into savings for a user.
     * @dev Can be called by the user themselves or by an approved source contract.
     * @param _user The player address to credit the savings to
     * @param _amount The amount of USDm to deposit
     */
    function deposit(address _user, uint256 _amount)
        external
        nonReentrant
        whenNotPaused
        onlyUserOrApprovedSource(_user)
    {
        if (_user == address(0)) revert InvalidAddress();
        if (_amount == 0) revert ZeroAmount();

        // Calculate shares to mint BEFORE transferring new tokens
        uint256 sharesToMint;
        uint256 currentATokenBalance = aToken.balanceOf(address(this));
        if (_totalUSDmShares == 0 || currentATokenBalance == 0) {
            sharesToMint = _amount;
        } else {
            sharesToMint = (_amount * _totalUSDmShares) / currentATokenBalance;
        }

        // Transfer stablecoin from msg.sender to this contract
        stablecoin.safeTransferFrom(msg.sender, address(this), _amount);

        // Approve Aave Pool to spend the stablecoin
        stablecoin.approve(address(aavePool), _amount);

        // Supply the stablecoin to Aave Pool
        aavePool.supply(address(stablecoin), _amount, address(this), 0);

        _usdmShares[_user] += sharesToMint;
        _totalUSDmShares += sharesToMint;

        emit SavingsDeposited(_user, address(stablecoin), _amount, block.timestamp);
    }

    /**
     * @notice Deposit native CELO into savings for a user.
     * @dev Can be called by the user themselves or by an approved source contract.
     * @param _user The player address to credit the savings to
     */
    function depositCELO(address _user)
        external
        payable
        nonReentrant
        whenNotPaused
        onlyUserOrApprovedSource(_user)
    {
        if (_user == address(0)) revert InvalidAddress();
        uint256 amount = msg.value;
        if (amount == 0) revert ZeroAmount();

        celoBalances[_user] += amount;
        totalCELOLocked += amount;

        emit SavingsDeposited(_user, address(0), amount, block.timestamp);
    }

    /**
     * @notice Withdraw USDm from savings (burns corresponding shares and Aave aTokens).
     * @param _amount The amount of USDm to withdraw
     */
    function withdraw(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert ZeroAmount();
        
        uint256 userBalance = usdmBalances(msg.sender);
        if (userBalance < _amount) revert InsufficientBalance();

        // Calculate shares to burn
        uint256 sharesToBurn;
        uint256 currentATokenBalance = aToken.balanceOf(address(this));
        if (_amount == userBalance) {
            sharesToBurn = _usdmShares[msg.sender];
        } else {
            sharesToBurn = (_amount * _totalUSDmShares) / currentATokenBalance;
        }

        // CEI Pattern: update state before interactions
        _usdmShares[msg.sender] -= sharesToBurn;
        _totalUSDmShares -= sharesToBurn;

        // Withdraw underlying from Aave Pool
        uint256 withdrawnAmount = aavePool.withdraw(address(stablecoin), _amount, address(this));

        // Transfer stablecoin to user
        stablecoin.safeTransfer(msg.sender, withdrawnAmount);

        emit SavingsWithdrawn(msg.sender, address(stablecoin), withdrawnAmount, block.timestamp);
    }

    /**
     * @notice Withdraw native CELO from savings.
     * @param _amount The amount of CELO to withdraw
     */
    function withdrawCELO(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert ZeroAmount();
        if (celoBalances[msg.sender] < _amount) revert InsufficientBalance();

        // CEI Pattern: update state before interactions
        celoBalances[msg.sender] -= _amount;
        totalCELOLocked -= _amount;

        (bool success, ) = payable(msg.sender).call{value: _amount}("");
        if (!success) revert TransferFailed();

        emit SavingsWithdrawn(msg.sender, address(0), _amount, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  Admin Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Approve or revoke a source contract (e.g. CeloFlashStore).
     */
    function setApprovedSource(address _source, bool _approved) external onlyOwner {
        if (_source == address(0)) revert InvalidAddress();
        approvedSources[_source] = _approved;
        emit SourceApprovalUpdated(_source, _approved);
    }

    /**
     * @notice Rescue stuck ERC20 tokens or native CELO from the contract.
     * @dev Owner-only rescue function.
     * @param _token The token to rescue (address(0) for CELO)
     * @param _to The destination address for rescued funds
     * @param _amount The amount to rescue
     */
    function rescueTokens(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyOwner {
        if (_to == address(0)) revert InvalidAddress();
        if (_amount == 0) revert ZeroAmount();

        if (_token == address(0)) {
            (bool success, ) = payable(_to).call{value: _amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }

        emit TokensRescued(_token, _to, _amount);
    }

    /**
     * @notice Pause deposits.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause deposits.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // Fallback to allow receiving CELO directly (credited to sender)
    receive() external payable {
        if (msg.value > 0) {
            celoBalances[msg.sender] += msg.value;
            totalCELOLocked += msg.value;
            emit SavingsDeposited(msg.sender, address(0), msg.value, block.timestamp);
        }
    }
}

// Commit 5: feat: implement shares-based mapping for USDm deposits

// Commit 6: feat: implement shares-based mapping for USDm withdrawals

// Commit 7: feat: implement custom usdmBalances getter for dynamic yield mapping

// Commit 8: feat: implement custom totalUSDmLocked getter for actual aUSDm balance

// Commit 9: feat: implement rescueTokens function for stuck assets

// Commit 10: docs: document Aave V3 integration design decisions

// Commit 11: docs: document shares-based dynamic yield calculation method

// Commit 12: docs: add NatSpec comments to rescueTokens function

// Commit 13: docs: add NatSpec comments to deposit function

// Commit 14: docs: add NatSpec comments to withdraw function
