// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title CeloFlashTournament
 * @author CeloFlash Team
 * @notice Manages USDm and native CELO -powered tournaments for the Celo Flash arcade game.
 *         Players pay entry fees, submit server-attested scores, and winners
 *         claim prize pool shares.
 *
 * @dev Security features:
 *   - ReentrancyGuard on all external state-mutating functions
 *   - Pausable circuit breaker
 *   - Server-signed score attestations (ECDSA) to prevent score manipulation
 *   - Pull-over-push pattern for prize claims
 *   - Bounded loops and pagination
 *   - Overflow-safe Solidity 0.8 arithmetic
 *   - SafeERC20 for token transfers
 */
contract CeloFlashTournament is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────

    /// @notice Maximum tournament duration (7 days)
    uint256 public constant MAX_DURATION = 7 days;

    /// @notice Minimum tournament duration (1 hour)
    uint256 public constant MIN_DURATION = 1 hours;

    /// @notice Maximum entry fee ($100 USDm — 18 decimals)
    uint256 public constant MAX_ENTRY_FEE = 100e18;

    /// @notice Protocol fee basis points (5% = 500 bps)
    uint256 public constant PROTOCOL_FEE_BPS = 500;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Maximum number of participants per tournament
    uint256 public constant MAX_PARTICIPANTS = 1_000;

    // ─────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────

    enum TournamentStatus {
        Active,
        Finalized,
        Cancelled
    }

    struct Tournament {
        uint256 id;
        address creator;
        string name;
        uint256 entryFee;       // in stablecoin or CELO (18 decimals)
        uint256 prizePool;      // total pot including seed + entries
        uint256 seedAmount;     // initial prize seed from creator
        uint256 startTime;
        uint256 endTime;
        uint256 participantCount;
        bool isNative;          // true = CELO, false = USDm
        TournamentStatus status;
        address winner;
        uint256 winningScore;
    }

    struct ScoreEntry {
        address player;
        uint256 score;
        uint256 submittedAt;
    }

    // ─────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────

    /// @notice The stablecoin used for entry fees and prizes (USDm on Celo)
    IERC20 public immutable stablecoin;

    /// @notice Address authorized to sign score attestations
    address public scoreVerifier;

    /// @notice Protocol fee recipient
    address public feeRecipient;

    /// @notice Accumulated protocol fees available for withdrawal (USDm)
    uint256 public accumulatedFees;

    /// @notice Accumulated protocol fees available for withdrawal (Native CELO)
    uint256 public accumulatedNativeFees;

    /// @notice Incrementing tournament ID
    uint256 public nextTournamentId;

    /// @notice Tournament data by ID
    mapping(uint256 => Tournament) public tournaments;

    /// @notice tournamentId => player => has joined
    mapping(uint256 => mapping(address => bool)) public hasJoined;

    /// @notice tournamentId => player => best score
    mapping(uint256 => mapping(address => uint256)) public playerBestScore;

    /// @notice tournamentId => sorted top scores (limited to top 10)
    mapping(uint256 => ScoreEntry[]) internal _leaderboard;

    /// @notice tournamentId => player => claimable prize
    mapping(uint256 => mapping(address => uint256)) public claimablePrize;

    /// @notice Replay protection: hash => used
    mapping(bytes32 => bool) public usedNonces;

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────

    event TournamentCreated(
        uint256 indexed tournamentId,
        address indexed creator,
        string name,
        uint256 entryFee,
        uint256 seedAmount,
        uint256 startTime,
        uint256 endTime,
        bool isNative
    );

    event TournamentJoined(
        uint256 indexed tournamentId,
        address indexed player,
        uint256 entryFee
    );

    event ScoreSubmitted(
        uint256 indexed tournamentId,
        address indexed player,
        uint256 score
    );

    event TournamentFinalized(
        uint256 indexed tournamentId,
        address indexed winner,
        uint256 winningScore,
        uint256 prizeAmount
    );

    event TournamentCancelled(uint256 indexed tournamentId);

    event PrizeClaimed(
        uint256 indexed tournamentId,
        address indexed player,
        uint256 amount
    );

    event FeesWithdrawn(address indexed recipient, uint256 amount, bool isNative);

    event ScoreVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // ─────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────

    error InvalidAddress();
    error InvalidEntryFee();
    error InvalidDuration();
    error InvalidSeedAmount();
    error TournamentNotActive();
    error TournamentNotEnded();
    error TournamentAlreadyFinalized();
    error AlreadyJoined();
    error MaxParticipantsReached();
    error InsufficientAllowance();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error NoPrizeToClaim();
    error NoFeesToWithdraw();
    error EmptyName();
    error InvalidValueSent();

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    /**
     * @param _stablecoin  Address of the stablecoin token (USDm)
     * @param _scoreVerifier  Address that signs score attestations
     * @param _feeRecipient  Address that receives protocol fees
     */
    constructor(
        address _stablecoin,
        address _scoreVerifier,
        address _feeRecipient
    ) Ownable(msg.sender) {
        if (_stablecoin == address(0)) revert InvalidAddress();
        if (_scoreVerifier == address(0)) revert InvalidAddress();
        if (_feeRecipient == address(0)) revert InvalidAddress();

        stablecoin = IERC20(_stablecoin);
        scoreVerifier = _scoreVerifier;
        feeRecipient = _feeRecipient;
    }

    // ─────────────────────────────────────────────
    //  Tournament Lifecycle
    // ─────────────────────────────────────────────

    /**
     * @notice Create a new tournament with an optional prize seed.
     * @param _name         Human-readable tournament name
     * @param _entryFee     Entry fee per player
     * @param _seedAmount   Initial prize pool seed from creator
     * @param _durationSecs Tournament duration in seconds
     * @param _isNative     True if tournament is CELO based, false if USDm
     * @return tournamentId The ID of the newly created tournament
     */
    function createTournament(
        string calldata _name,
        uint256 _entryFee,
        uint256 _seedAmount,
        uint256 _durationSecs,
        bool _isNative
    ) external payable nonReentrant whenNotPaused returns (uint256 tournamentId) {
        if (bytes(_name).length == 0) revert EmptyName();
        if (_entryFee > MAX_ENTRY_FEE) revert InvalidEntryFee();
        if (_durationSecs < MIN_DURATION || _durationSecs > MAX_DURATION) revert InvalidDuration();

        // Handle seed funding
        if (_isNative) {
            if (msg.value != _seedAmount) revert InvalidValueSent();
        } else {
            if (msg.value != 0) revert InvalidValueSent();
            if (_seedAmount > 0) {
                stablecoin.safeTransferFrom(msg.sender, address(this), _seedAmount);
            }
        }

        tournamentId = nextTournamentId++;

        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + _durationSecs;

        tournaments[tournamentId] = Tournament({
            id: tournamentId,
            creator: msg.sender,
            name: _name,
            entryFee: _entryFee,
            prizePool: _seedAmount,
            seedAmount: _seedAmount,
            startTime: startTime,
            endTime: endTime,
            participantCount: 0,
            isNative: _isNative,
            status: TournamentStatus.Active,
            winner: address(0),
            winningScore: 0
        });

        emit TournamentCreated(
            tournamentId,
            msg.sender,
            _name,
            _entryFee,
            _seedAmount,
            startTime,
            endTime,
            _isNative
        );
    }

    /**
     * @notice Join an active tournament by paying the entry fee.
     * @param _tournamentId The tournament to join
     */
    function joinTournament(uint256 _tournamentId)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        Tournament storage t = tournaments[_tournamentId];
        if (t.status != TournamentStatus.Active) revert TournamentNotActive();
        if (block.timestamp >= t.endTime) revert TournamentNotActive();
        if (hasJoined[_tournamentId][msg.sender]) revert AlreadyJoined();
        if (t.participantCount >= MAX_PARTICIPANTS) revert MaxParticipantsReached();

        hasJoined[_tournamentId][msg.sender] = true;
        t.participantCount++;

        if (t.entryFee > 0) {
            // Deduct protocol fee from entry
            uint256 protocolFee = (t.entryFee * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
            uint256 prizeContribution = t.entryFee - protocolFee;

            if (t.isNative) {
                if (msg.value != t.entryFee) revert InvalidValueSent();
                t.prizePool += prizeContribution;
                accumulatedNativeFees += protocolFee;
            } else {
                if (msg.value != 0) revert InvalidValueSent();
                stablecoin.safeTransferFrom(msg.sender, address(this), t.entryFee);
                t.prizePool += prizeContribution;
                accumulatedFees += protocolFee;
            }
        } else {
            if (msg.value != 0) revert InvalidValueSent();
        }

        emit TournamentJoined(_tournamentId, msg.sender, t.entryFee);
    }

    /**
     * @notice Submit a game score with server-signed attestation.
     * @param _tournamentId  Tournament ID
     * @param _score         The game score
     * @param _nonce         Unique nonce for replay protection
     * @param _signature     ECDSA signature from the score verifier
     */
    function submitScore(
        uint256 _tournamentId,
        uint256 _score,
        bytes32 _nonce,
        bytes calldata _signature
    ) external nonReentrant whenNotPaused {
        Tournament storage t = tournaments[_tournamentId];
        if (t.status != TournamentStatus.Active) revert TournamentNotActive();
        if (block.timestamp >= t.endTime) revert TournamentNotActive();
        if (!hasJoined[_tournamentId][msg.sender]) revert TournamentNotActive();
        if (usedNonces[_nonce]) revert NonceAlreadyUsed();

        // Verify server signature
        bytes32 messageHash = keccak256(
            abi.encodePacked(_tournamentId, msg.sender, _score, _nonce)
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(_signature);
        if (signer != scoreVerifier) revert InvalidSignature();

        usedNonces[_nonce] = true;

        // Update player's best score
        if (_score > playerBestScore[_tournamentId][msg.sender]) {
            playerBestScore[_tournamentId][msg.sender] = _score;
            _updateLeaderboard(_tournamentId, msg.sender, _score);
        }

        emit ScoreSubmitted(_tournamentId, msg.sender, _score);
    }

    /**
     * @notice Finalize a tournament after it has ended.
     * @param _tournamentId The tournament to finalize
     */
    function finalizeTournament(uint256 _tournamentId)
        external
        nonReentrant
        whenNotPaused
    {
        Tournament storage t = tournaments[_tournamentId];
        if (t.status != TournamentStatus.Active) revert TournamentAlreadyFinalized();
        if (block.timestamp < t.endTime) revert TournamentNotEnded();

        t.status = TournamentStatus.Finalized;

        ScoreEntry[] storage lb = _leaderboard[_tournamentId];
        uint256 pool = t.prizePool;

        if (lb.length == 0 || pool == 0) {
            // No scores submitted or no prize pool — nothing to distribute
            emit TournamentFinalized(_tournamentId, address(0), 0, 0);
            return;
        }

        // Prize distribution percentages (bps of prize pool)
        // 1st: 60%, 2nd: 25%, 3rd: 15%
        uint256[3] memory shares = [uint256(6000), uint256(2500), uint256(1500)];
        uint256 distributed = 0;

        uint256 winnerCount = lb.length < 3 ? lb.length : 3;

        // If only 1 participant, they get the full pool
        if (winnerCount == 1) {
            claimablePrize[_tournamentId][lb[0].player] = pool;
            distributed = pool;
        } else if (winnerCount == 2) {
            // 1st gets 70%, 2nd gets 30%
            uint256 first = (pool * 7000) / BPS_DENOMINATOR;
            uint256 second = pool - first;
            claimablePrize[_tournamentId][lb[0].player] = first;
            claimablePrize[_tournamentId][lb[1].player] = second;
            distributed = pool;
        } else {
            // 3+ participants: standard split
            for (uint256 i; i < 3; ++i) {
                uint256 prize = (pool * shares[i]) / BPS_DENOMINATOR;
                claimablePrize[_tournamentId][lb[i].player] += prize;
                distributed += prize;
            }

            // Any dust goes to 1st place
            if (distributed < pool) {
                claimablePrize[_tournamentId][lb[0].player] += (pool - distributed);
            }
        }

        t.winner = lb[0].player;
        t.winningScore = lb[0].score;

        emit TournamentFinalized(
            _tournamentId,
            lb[0].player,
            lb[0].score,
            claimablePrize[_tournamentId][lb[0].player]
        );
    }

    /**
     * @notice Cancel a tournament (only creator or owner, only before finalization).
     * @param _tournamentId The tournament to cancel
     */
    function cancelTournament(uint256 _tournamentId)
        external
        nonReentrant
    {
        Tournament storage t = tournaments[_tournamentId];
        if (t.status != TournamentStatus.Active) revert TournamentAlreadyFinalized();
        if (msg.sender != t.creator && msg.sender != owner()) revert InvalidAddress();

        t.status = TournamentStatus.Cancelled;

        // Refund seed to creator
        if (t.seedAmount > 0) {
            if (t.isNative) {
                (bool success, ) = t.creator.call{value: t.seedAmount}("");
                require(success, "NativeTransferFailed");
            } else {
                stablecoin.safeTransfer(t.creator, t.seedAmount);
            }
        }

        // Return protocol fees from cancelled tournament entries
        uint256 protocolFeesFromEntries = (t.entryFee * t.participantCount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;

        if (t.isNative) {
            if (protocolFeesFromEntries <= accumulatedNativeFees) {
                accumulatedNativeFees -= protocolFeesFromEntries;
            }
        } else {
            if (protocolFeesFromEntries <= accumulatedFees) {
                accumulatedFees -= protocolFeesFromEntries;
            }
        }

        emit TournamentCancelled(_tournamentId);
    }

    /**
     * @notice Claim prize winnings or refund from a finalized/cancelled tournament.
     * @param _tournamentId The tournament ID
     */
    function claimPrize(uint256 _tournamentId)
        external
        nonReentrant
    {
        Tournament storage t = tournaments[_tournamentId];

        uint256 amount;

        if (t.status == TournamentStatus.Finalized) {
            amount = claimablePrize[_tournamentId][msg.sender];
            if (amount == 0) revert NoPrizeToClaim();
            claimablePrize[_tournamentId][msg.sender] = 0;
        } else if (t.status == TournamentStatus.Cancelled) {
            if (!hasJoined[_tournamentId][msg.sender]) revert NoPrizeToClaim();
            if (claimablePrize[_tournamentId][msg.sender] == type(uint256).max) revert NoPrizeToClaim(); // already claimed

            amount = t.entryFee;
            claimablePrize[_tournamentId][msg.sender] = type(uint256).max; // mark as claimed
        } else {
            revert TournamentNotActive();
        }

        if (amount > 0) {
            if (t.isNative) {
                (bool success, ) = msg.sender.call{value: amount}("");
                require(success, "NativeTransferFailed");
            } else {
                stablecoin.safeTransfer(msg.sender, amount);
            }
        }

        emit PrizeClaimed(_tournamentId, msg.sender, amount);
    }

    // ─────────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Get the leaderboard for a tournament (top 10).
     * @param _tournamentId Tournament ID
     * @return entries Array of score entries
     */
    function getLeaderboard(uint256 _tournamentId)
        external
        view
        returns (ScoreEntry[] memory entries)
    {
        return _leaderboard[_tournamentId];
    }

    /**
     * @notice Get full tournament details.
     * @param _tournamentId Tournament ID
     * @return Tournament struct
     */
    function getTournament(uint256 _tournamentId)
        external
        view
        returns (Tournament memory)
    {
        return tournaments[_tournamentId];
    }

    /**
     * @notice Check if a player has joined a tournament.
     */
    function isPlayerJoined(uint256 _tournamentId, address _player)
        external
        view
        returns (bool)
    {
        return hasJoined[_tournamentId][_player];
    }

    // ─────────────────────────────────────────────
    //  Admin Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Update the score verifier address.
     * @param _newVerifier New verifier address
     */
    function setScoreVerifier(address _newVerifier) external onlyOwner {
        if (_newVerifier == address(0)) revert InvalidAddress();
        address old = scoreVerifier;
        scoreVerifier = _newVerifier;
        emit ScoreVerifierUpdated(old, _newVerifier);
    }

    /**
     * @notice Update the fee recipient address.
     * @param _newRecipient New fee recipient
     */
    function setFeeRecipient(address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert InvalidAddress();
        address old = feeRecipient;
        feeRecipient = _newRecipient;
        emit FeeRecipientUpdated(old, _newRecipient);
    }

    /**
     * @notice Withdraw accumulated protocol fees.
     */
    function withdrawFees() external nonReentrant {
        uint256 amount = accumulatedFees;
        uint256 nativeAmount = accumulatedNativeFees;

        if (amount == 0 && nativeAmount == 0) revert NoFeesToWithdraw();

        if (amount > 0) {
            accumulatedFees = 0;
            stablecoin.safeTransfer(feeRecipient, amount);
            emit FeesWithdrawn(feeRecipient, amount, false);
        }

        if (nativeAmount > 0) {
            accumulatedNativeFees = 0;
            (bool success, ) = feeRecipient.call{value: nativeAmount}("");
            require(success, "NativeTransferFailed");
            emit FeesWithdrawn(feeRecipient, nativeAmount, true);
        }
    }

    /**
     * @notice Pause the contract (emergency stop).
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

    // ─────────────────────────────────────────────
    //  Internal Helpers
    // ─────────────────────────────────────────────

    /**
     * @dev Update the sorted leaderboard (top 10).
     *      Insertion sort — bounded to 10 iterations max.
     */
    function _updateLeaderboard(
        uint256 _tournamentId,
        address _player,
        uint256 _score
    ) internal {
        ScoreEntry[] storage lb = _leaderboard[_tournamentId];

        // Check if player already exists in leaderboard
        for (uint256 i; i < lb.length; ++i) {
            if (lb[i].player == _player) {
                lb[i].score = _score;
                lb[i].submittedAt = block.timestamp;
                // Re-sort after update
                _sortLeaderboard(lb);
                return;
            }
        }

        // Add new entry
        ScoreEntry memory newEntry = ScoreEntry({
            player: _player,
            score: _score,
            submittedAt: block.timestamp
        });

        if (lb.length < 10) {
            lb.push(newEntry);
        } else if (_score > lb[lb.length - 1].score) {
            // Replace last entry
            lb[lb.length - 1] = newEntry;
        } else {
            return; // Not in top 10
        }

        _sortLeaderboard(lb);
    }

    /**
     * @dev Simple insertion sort for leaderboard (max 10 elements).
     */
    function _sortLeaderboard(ScoreEntry[] storage lb) internal {
        uint256 len = lb.length;
        for (uint256 i = 1; i < len; ++i) {
            ScoreEntry memory key = lb[i];
            uint256 j = i;
            while (j > 0 && lb[j - 1].score < key.score) {
                lb[j] = lb[j - 1];
                --j;
            }
            if (j != i) {
                lb[j] = key;
            }
        }
    }

    // Fallback and Receive
    receive() external payable {
        revert("Use joinTournament or createTournament to send native CELO");
    }
}
