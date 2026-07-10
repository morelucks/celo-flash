// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CeloFlashSavings
 * @author CeloFlash Team
 * @notice Handles on-chain savings for Celo Flash players.
 *         Allows locking USDm stablecoin and native CELO, with yield-generation routing readiness.
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

    /// @notice Approved sources that can call deposit on behalf of users (e.g., CeloFlashStore)
    mapping(address => bool) public approvedSources;

    /// @notice USDm savings balance per user
    mapping(address => uint256) public usdmBalances;

    /// @notice CELO savings balance per user
    mapping(address => uint256) public celoBalances;

    /// @notice Total USDm locked in the contract
    uint256 public totalUSDmLocked;

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

    constructor(address _stablecoin) Ownable(msg.sender) {
        if (_stablecoin == address(0)) revert InvalidAddress();
        stablecoin = IERC20(_stablecoin);
    }

    // ─────────────────────────────────────────────
    //  External/Public Write Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Deposit USDm into savings for a user.
     * @dev Can be called by the user themselves or by an approved source contract (e.g., CeloFlashStore during round-up).
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

        // Transfer tokens from msg.sender (the caller must approve this contract first or the calling contract transfers them)
        stablecoin.safeTransferFrom(msg.sender, address(this), _amount);

        usdmBalances[_user] += _amount;
        totalUSDmLocked += _amount;

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
     * @notice Withdraw USDm from savings.
     * @param _amount The amount of USDm to withdraw
     */
    function withdraw(uint256 _amount) external nonReentrant {
        if (_amount == 0) revert ZeroAmount();
        if (usdmBalances[msg.sender] < _amount) revert InsufficientBalance();

        // CEI Pattern: update state before interactions
        usdmBalances[msg.sender] -= _amount;
        totalUSDmLocked -= _amount;

        stablecoin.safeTransfer(msg.sender, _amount);

        emit SavingsWithdrawn(msg.sender, address(stablecoin), _amount, block.timestamp);
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
