// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title CeloFlashWager
 * @author CeloFlash Team
 * @notice Manages native CELO wager mode for the Celo Flash arcade game.
 *         Players stake CELO before a game round. If they exceed a target
 *         score (verified by server attestation), they win a multiplied reward.
 *         The house always maintains a solvency reserve.
 *
 * @dev Security features:
 *   - ReentrancyGuard on all external state-mutating functions
 *   - Pausable circuit breaker
 *   - Server-signed score attestations (ECDSA)
 *   - Maximum wager caps
 *   - House reserve solvency checks
 *   - Pull-over-push pattern for withdrawals
 *   - CEI (Checks-Effects-Interactions) pattern throughout
 */
contract CeloFlashWager is ReentrancyGuard, Ownable, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────

    /// @notice Minimum wager amount (0.001 CELO)
    uint256 public constant MIN_WAGER = 0.001 ether;

    /// @notice Maximum wager amount (10 CELO)
    uint256 public constant MAX_WAGER = 10 ether;

    /// @notice Win multiplier in basis points (200% = 2x = 20000 bps)
    uint256 public constant WIN_MULTIPLIER_BPS = 20_000;

    /// @notice Score threshold to win (configurable by owner)
    uint256 public scoreThreshold;

    /// @notice Protocol fee on winnings (5%)
    uint256 public constant HOUSE_EDGE_BPS = 500;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Maximum time for a wager to be resolved (1 hour)
    uint256 public constant WAGER_EXPIRY = 1 hours;

    // ─────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────

    enum WagerStatus {
        Pending,     // Wager placed, game in progress
        Won,         // Player won, payout available
        Lost,        // Player lost, wager forfeited
        Expired,     // Wager expired without resolution
        Claimed      // Payout claimed
    }

    struct Wager {
        address player;
        uint256 amount;
        uint256 potentialPayout;
        uint256 createdAt;
        uint256 score;
        WagerStatus status;
    }

    // ─────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────

    /// @notice Score verification signer
    address public scoreVerifier;

    /// @notice Treasury address for house edge
    address public treasury;

    /// @notice Incrementing wager ID
    uint256 public nextWagerId;

    /// @notice Active wager per player (only one at a time)
    mapping(address => uint256) public activeWager;

    /// @notice Wager data by ID
    mapping(uint256 => Wager) public wagers;

    /// @notice Replay protection
    mapping(bytes32 => bool) public usedNonces;

    /// @notice Total CELO locked in pending wagers
    uint256 public totalPendingLiabilities;

    /// @notice Accumulated house edge
    uint256 public accumulatedHouseEdge;

    /// @notice Total wagers placed
    uint256 public totalWagersPlaced;

    /// @notice Total wagers won
    uint256 public totalWagersWon;

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────

    event WagerPlaced(
        uint256 indexed wagerId,
        address indexed player,
        uint256 amount,
        uint256 potentialPayout
    );

    event WagerResolved(
        uint256 indexed wagerId,
        address indexed player,
        uint256 score,
        WagerStatus status,
        uint256 payout
    );

    event WagerClaimed(
        uint256 indexed wagerId,
        address indexed player,
        uint256 amount
    );

    event WagerExpired(uint256 indexed wagerId, address indexed player);

    event HouseEdgeWithdrawn(address indexed treasury, uint256 amount);

    event HouseFunded(address indexed funder, uint256 amount);

    event ScoreThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ─────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────

    error InvalidAddress();
    error WagerTooLow();
    error WagerTooHigh();
    error ActiveWagerExists();
    error NoActiveWager();
    error WagerNotPending();
    error WagerNotWon();
    error InsufficientHouseReserve();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error WagerNotExpired();
    error NoHouseEdgeToWithdraw();
    error TransferFailed();

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    /**
     * @param _scoreVerifier  Address that signs score attestations
     * @param _treasury       Treasury address for house edge
     * @param _scoreThreshold Minimum score to win a wager
     */
    constructor(
        address _scoreVerifier,
        address _treasury,
        uint256 _scoreThreshold
    ) Ownable(msg.sender) {
        if (_scoreVerifier == address(0)) revert InvalidAddress();
        if (_treasury == address(0)) revert InvalidAddress();

        scoreVerifier = _scoreVerifier;
        treasury = _treasury;
        scoreThreshold = _scoreThreshold;
    }

    // ─────────────────────────────────────────────
    //  Core Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Place a CELO wager before starting a game round.
     * @dev Player sends native CELO. Contract checks solvency before accepting.
     */
    function placeWager()
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (msg.value < MIN_WAGER) revert WagerTooLow();
        if (msg.value > MAX_WAGER) revert WagerTooHigh();
        if (activeWager[msg.sender] != 0) {
            // Check if previous wager is still pending
            Wager storage prev = wagers[activeWager[msg.sender]];
            if (prev.status == WagerStatus.Pending) revert ActiveWagerExists();
        }

        uint256 potentialPayout = (msg.value * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;
        uint256 houseRisk = potentialPayout - msg.value; // net risk to house

        // Solvency check: house must have enough reserves
        uint256 availableReserve = address(this).balance - totalPendingLiabilities - accumulatedHouseEdge;
        if (availableReserve < houseRisk) revert InsufficientHouseReserve();

        uint256 wagerId = ++nextWagerId;

        wagers[wagerId] = Wager({
            player: msg.sender,
            amount: msg.value,
            potentialPayout: potentialPayout,
            createdAt: block.timestamp,
            score: 0,
            status: WagerStatus.Pending
        });

        activeWager[msg.sender] = wagerId;
        totalPendingLiabilities += potentialPayout;
        totalWagersPlaced++;

        emit WagerPlaced(wagerId, msg.sender, msg.value, potentialPayout);
    }

    /**
     * @notice Resolve a wager with a server-attested score.
     * @param _wagerId   The wager to resolve
     * @param _score     The game score
     * @param _nonce     Unique nonce for replay protection
     * @param _signature ECDSA signature from score verifier
     */
    function resolveWager(
        uint256 _wagerId,
        uint256 _score,
        bytes32 _nonce,
        bytes calldata _signature
    ) external nonReentrant whenNotPaused {
        Wager storage w = wagers[_wagerId];
        if (w.status != WagerStatus.Pending) revert WagerNotPending();
        if (msg.sender != w.player) revert NoActiveWager();
        if (usedNonces[_nonce]) revert NonceAlreadyUsed();

        // Verify server signature
        bytes32 messageHash = keccak256(
            abi.encodePacked(_wagerId, w.player, _score, _nonce)
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(_signature);
        if (signer != scoreVerifier) revert InvalidSignature();

        usedNonces[_nonce] = true;
        w.score = _score;

        // Release liability
        totalPendingLiabilities -= w.potentialPayout;

        if (_score >= scoreThreshold) {
            // Player wins
            uint256 grossPayout = w.potentialPayout;
            uint256 houseEdge = (grossPayout * HOUSE_EDGE_BPS) / BPS_DENOMINATOR;
            uint256 netPayout = grossPayout - houseEdge;

            w.status = WagerStatus.Won;
            accumulatedHouseEdge += houseEdge;
            totalWagersWon++;

            emit WagerResolved(_wagerId, w.player, _score, WagerStatus.Won, netPayout);
        } else {
            // Player loses — wager stays in contract as house profit
            w.status = WagerStatus.Lost;

            emit WagerResolved(_wagerId, w.player, _score, WagerStatus.Lost, 0);
        }
    }

    /**
     * @notice Claim winnings from a won wager (pull pattern).
     * @param _wagerId The wager to claim
     */
    function claimWinnings(uint256 _wagerId)
        external
        nonReentrant
    {
        Wager storage w = wagers[_wagerId];
        if (w.player != msg.sender) revert NoActiveWager();
        if (w.status != WagerStatus.Won) revert WagerNotWon();

        uint256 grossPayout = w.potentialPayout;
        uint256 houseEdge = (grossPayout * HOUSE_EDGE_BPS) / BPS_DENOMINATOR;
        uint256 netPayout = grossPayout - houseEdge;

        w.status = WagerStatus.Claimed;

        // CEI: state updated before transfer
        (bool success,) = payable(msg.sender).call{value: netPayout}("");
        if (!success) revert TransferFailed();

        emit WagerClaimed(_wagerId, msg.sender, netPayout);
    }

    /**
     * @notice Expire a stale wager that wasn't resolved in time.
     *         Returns the wagered amount to the player.
     * @param _wagerId The wager to expire
     */
    function expireWager(uint256 _wagerId)
        external
        nonReentrant
    {
        Wager storage w = wagers[_wagerId];
        if (w.status != WagerStatus.Pending) revert WagerNotPending();
        if (block.timestamp < w.createdAt + WAGER_EXPIRY) revert WagerNotExpired();

        w.status = WagerStatus.Expired;
        totalPendingLiabilities -= w.potentialPayout;

        // Refund original wager amount
        (bool success,) = payable(w.player).call{value: w.amount}("");
        if (!success) revert TransferFailed();

        emit WagerExpired(_wagerId, w.player);
    }

    // ─────────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Get wager details.
     */
    function getWager(uint256 _wagerId)
        external
        view
        returns (Wager memory)
    {
        return wagers[_wagerId];
    }

    /**
     * @notice Get the current house reserve (available for covering wagers).
     */
    function getHouseReserve()
        external
        view
        returns (uint256)
    {
        uint256 balance = address(this).balance;
        uint256 locked = totalPendingLiabilities + accumulatedHouseEdge;
        return balance > locked ? balance - locked : 0;
    }

    /**
     * @notice Get player's active wager ID (0 if none pending).
     */
    function getActiveWager(address _player)
        external
        view
        returns (uint256)
    {
        uint256 wId = activeWager[_player];
        if (wId != 0 && wagers[wId].status == WagerStatus.Pending) {
            return wId;
        }
        return 0;
    }

    // ─────────────────────────────────────────────
    //  Admin Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Fund the house reserve with CELO.
     */
    function fundHouse() external payable {
        if (msg.value == 0) revert WagerTooLow();
        emit HouseFunded(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw accumulated house edge.
     */
    function withdrawHouseEdge() external nonReentrant onlyOwner {
        uint256 amount = accumulatedHouseEdge;
        if (amount == 0) revert NoHouseEdgeToWithdraw();
        accumulatedHouseEdge = 0;

        (bool success,) = payable(treasury).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit HouseEdgeWithdrawn(treasury, amount);
    }

    /**
     * @notice Update score threshold.
     */
    function setScoreThreshold(uint256 _newThreshold) external onlyOwner {
        uint256 old = scoreThreshold;
        scoreThreshold = _newThreshold;
        emit ScoreThresholdUpdated(old, _newThreshold);
    }

    /**
     * @notice Update score verifier.
     */
    function setScoreVerifier(address _newVerifier) external onlyOwner {
        if (_newVerifier == address(0)) revert InvalidAddress();
        scoreVerifier = _newVerifier;
    }

    /**
     * @notice Update treasury address.
     */
    function setTreasury(address _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert InvalidAddress();
        treasury = _newTreasury;
    }

    /**
     * @notice Pause the contract.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Accept CELO deposits for house funding
    receive() external payable {
        emit HouseFunded(msg.sender, msg.value);
    }
}
