// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CeloFlashStore
 * @author CeloFlash Team
 * @notice Handles on-chain purchases for power-ups, spawner skins,
 *         and daily renewals in the Celo Flash arcade game.
 *         All purchases use stablecoin (cUSD on Celo).
 *
 * @dev Security features:
 *   - ReentrancyGuard on all purchase functions
 *   - Pausable circuit breaker
 *   - SafeERC20 for token transfers
 *   - Owner-managed item catalog
 *   - Purchase receipts emitted as events
 */
contract CeloFlashStore is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────
    //  Types
    // ─────────────────────────────────────────────

    enum ItemType {
        PowerupMagnet,
        PowerupShield,
        PowerupClock,
        PowerupBundle,
        SpawnerValora,
        SpawnerMento,
        ScoreMultiplier,
        DailyRenewal
    }

    struct StoreItem {
        ItemType itemType;
        uint256 price;      // stablecoin (18 decimals)
        bool active;
        uint256 maxPerTx;   // maximum quantity per single purchase
    }

    struct PurchaseReceipt {
        address buyer;
        ItemType itemType;
        uint256 quantity;
        uint256 totalPaid;
        uint256 timestamp;
    }

    // ─────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────

    /// @notice The stablecoin used for payments (cUSD)
    IERC20 public immutable stablecoin;

    /// @notice Revenue recipient
    address public revenueRecipient;

    /// @notice Item catalog
    mapping(ItemType => StoreItem) public storeItems;

    /// @notice Total purchases per player per item type
    mapping(address => mapping(ItemType => uint256)) public playerPurchases;

    /// @notice Total revenue collected
    uint256 public totalRevenue;

    /// @notice Purchase ID counter
    uint256 public nextPurchaseId;

    /// @notice Purchase receipts by ID
    mapping(uint256 => PurchaseReceipt) public receipts;

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────

    event ItemPurchased(
        uint256 indexed purchaseId,
        address indexed buyer,
        ItemType itemType,
        uint256 quantity,
        uint256 totalPaid
    );

    event ItemUpdated(ItemType itemType, uint256 newPrice, bool active);

    event RevenueWithdrawn(address indexed recipient, uint256 amount);

    event RevenueRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    // ─────────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────────

    error InvalidAddress();
    error ItemNotActive();
    error InvalidQuantity();
    error ExceedsMaxPerTx();
    error NoRevenueToWithdraw();

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────

    /**
     * @param _stablecoin      Address of the cUSD token
     * @param _revenueRecipient Address receiving store revenue
     */
    constructor(
        address _stablecoin,
        address _revenueRecipient
    ) Ownable(msg.sender) {
        if (_stablecoin == address(0)) revert InvalidAddress();
        if (_revenueRecipient == address(0)) revert InvalidAddress();

        stablecoin = IERC20(_stablecoin);
        revenueRecipient = _revenueRecipient;

        // Initialize default item prices (cUSD, 18 decimals)
        // Power-ups
        _setItem(ItemType.PowerupMagnet,      0.08e18,  true, 10);
        _setItem(ItemType.PowerupShield,       0.08e18,  true, 10);
        _setItem(ItemType.PowerupClock,        0.08e18,  true, 10);
        _setItem(ItemType.PowerupBundle,       0.20e18,  true, 5);

        // Spawner skins
        _setItem(ItemType.SpawnerValora,       0.05e18,  true, 1);
        _setItem(ItemType.SpawnerMento,        0.05e18,  true, 1);

        // Consumables
        _setItem(ItemType.ScoreMultiplier,     0.04e18,  true, 99);
        _setItem(ItemType.DailyRenewal,        0.10e18,  true, 10);
    }

    // ─────────────────────────────────────────────
    //  Purchase Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Purchase a store item.
     * @param _itemType The type of item to purchase
     * @param _quantity Number of items to buy
     */
    function purchaseItem(ItemType _itemType, uint256 _quantity)
        external
        nonReentrant
        whenNotPaused
    {
        if (_quantity == 0) revert InvalidQuantity();

        StoreItem storage item = storeItems[_itemType];
        if (!item.active) revert ItemNotActive();
        if (_quantity > item.maxPerTx) revert ExceedsMaxPerTx();

        uint256 totalCost = item.price * _quantity;

        // Transfer payment
        stablecoin.safeTransferFrom(msg.sender, address(this), totalCost);

        // Record purchase
        uint256 purchaseId = nextPurchaseId++;
        receipts[purchaseId] = PurchaseReceipt({
            buyer: msg.sender,
            itemType: _itemType,
            quantity: _quantity,
            totalPaid: totalCost,
            timestamp: block.timestamp
        });

        playerPurchases[msg.sender][_itemType] += _quantity;
        totalRevenue += totalCost;

        emit ItemPurchased(purchaseId, msg.sender, _itemType, _quantity, totalCost);
    }

    // ─────────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Get item details.
     * @param _itemType The item type to query
     * @return price Item price
     * @return active Whether the item is purchasable
     * @return maxPerTx Maximum quantity per transaction
     */
    function getItem(ItemType _itemType)
        external
        view
        returns (uint256 price, bool active, uint256 maxPerTx)
    {
        StoreItem storage item = storeItems[_itemType];
        return (item.price, item.active, item.maxPerTx);
    }

    /**
     * @notice Get player's total purchase count for an item type.
     */
    function getPlayerPurchaseCount(address _player, ItemType _itemType)
        external
        view
        returns (uint256)
    {
        return playerPurchases[_player][_itemType];
    }

    // ─────────────────────────────────────────────
    //  Admin Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Update a store item's price and status.
     * @param _itemType  The item type to update
     * @param _price     New price (18 decimals)
     * @param _active    Whether the item is active
     * @param _maxPerTx  Max quantity per transaction
     */
    function setItem(
        ItemType _itemType,
        uint256 _price,
        bool _active,
        uint256 _maxPerTx
    ) external onlyOwner {
        _setItem(_itemType, _price, _active, _maxPerTx);
    }

    /**
     * @notice Update revenue recipient.
     */
    function setRevenueRecipient(address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert InvalidAddress();
        address old = revenueRecipient;
        revenueRecipient = _newRecipient;
        emit RevenueRecipientUpdated(old, _newRecipient);
    }

    /**
     * @notice Withdraw accumulated revenue.
     */
    function withdrawRevenue() external nonReentrant {
        uint256 balance = stablecoin.balanceOf(address(this));
        if (balance == 0) revert NoRevenueToWithdraw();
        stablecoin.safeTransfer(revenueRecipient, balance);
        emit RevenueWithdrawn(revenueRecipient, balance);
    }

    /**
     * @notice Pause the store (emergency stop).
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the store.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ─────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────

    function _setItem(
        ItemType _itemType,
        uint256 _price,
        bool _active,
        uint256 _maxPerTx
    ) internal {
        storeItems[_itemType] = StoreItem({
            itemType: _itemType,
            price: _price,
            active: _active,
            maxPerTx: _maxPerTx
        });
        emit ItemUpdated(_itemType, _price, _active);
    }
}
